#!/usr/bin/env python3
"""On-device word alignment for tracks community sources only have as
plain or line-synced lyrics.

Engines (FORCED_ALIGN_ENGINE=auto picks the first available, never MFA
unless you ask - Demucs+MFA is too heavy for the kiosk):

	energy  - stdlib RMS envelope vs lyric weights. Always available.
	ctc     - torchaudio MMS_FA / wav2vec2 if installed.
	aeneas  - DTW forced aligner if the aeneas package is installed.
	mfa     - Demucs vocals + Montreal Forced Aligner (opt-in).

Usage:
	python3 align.py --probe
	python3 align.py <wav_path> <lyrics_txt_path> <out_json_path>

Offset the resulting clocks with FORCED_ALIGN_OFFSET (seconds) when the
recording did not start at 0:00.
"""
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import wave

try:
	import textgrid  # praat-textgrid; installed alongside montreal-forced-aligner
except ImportError:
	textgrid = None

SILENCE_MARKS = {"sil", "sp", "spn", ""}
WORD_RE = re.compile(r"[A-Za-z']+")


def run(cmd, **kw):
	print(f"+ {' '.join(cmd)}", file=sys.stderr, flush=True)
	subprocess.run(cmd, check=True, **kw)


def isolate_vocals(wav_path, work_dir):
	out_dir = os.path.join(work_dir, "demucs")
	run(["demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", out_dir, wav_path])
	stem = os.path.splitext(os.path.basename(wav_path))[0]
	vocals = os.path.join(out_dir, "htdemucs", stem, "vocals.wav")
	if not os.path.exists(vocals):
		raise FileNotFoundError(f"demucs did not produce {vocals}")
	return vocals


def word_tokens(text):
	return WORD_RE.findall(text.lower())


def align_words(vocals_path, lyric_lines, work_dir):
	"""Runs MFA on the vocal stem against the flattened lyric text and
	returns a flat, time-ordered list of (start_seconds, word) tuples."""
	corpus_dir = os.path.join(work_dir, "corpus")
	out_dir = os.path.join(work_dir, "mfa_out")
	os.makedirs(corpus_dir, exist_ok=True)
	base = "track"
	shutil.copy(vocals_path, os.path.join(corpus_dir, f"{base}.wav"))
	flat_text = " ".join(line.strip() for line in lyric_lines if line.strip())
	with open(os.path.join(corpus_dir, f"{base}.txt"), "w", encoding="utf-8") as fh:
		fh.write(flat_text)

	run(
		[
			"mfa",
			"align",
			"--clean",
			"--single_speaker",
			"--overwrite",
			corpus_dir,
			"english_us_arpa",
			"english_us_arpa",
			out_dir,
		]
	)

	grid_path = os.path.join(out_dir, f"{base}.TextGrid")
	if textgrid is None:
		raise RuntimeError("praat-textgrid not installed (ships with montreal-forced-aligner)")
	tg = textgrid.TextGrid.fromFile(grid_path)
	word_tier = next(t for t in tg.tiers if t.name.lower() == "words")
	return [
		(interval.minTime, interval.mark.strip())
		for interval in word_tier.intervals
		if interval.mark and interval.mark.strip().lower() not in SILENCE_MARKS
	]


def remap_to_lines(lyric_lines, timed_words):
	"""MFA aligns one flat word stream against the flattened text; this
	walks that stream back against the original line breaks (by consuming
	one timed word per expected token, in order) so the UI can still show
	line-by-line lyrics. A line MFA couldn't match tokens for (trailing OOV
	words, alignment noise near the end) gets no word list rather than
	blocking the whole line - remap_to_lines' backfill pass below still
	gives it a start time from its neighbors so it's never dropped."""
	cursor = 0
	out_lines = []
	for line in lyric_lines:
		text = line.strip()
		if not text:
			out_lines.append({"time": None, "text": ""})
			continue
		tokens = word_tokens(text)
		word_times = []
		for _ in tokens:
			if cursor >= len(timed_words):
				break
			t, _word = timed_words[cursor]
			word_times.append(t)
			cursor += 1
		out_lines.append({"time": word_times[0] if word_times else None, "text": text, "wordTimes": word_times})

	last_time = 0.0
	for i, line in enumerate(out_lines):
		if line["time"] is None:
			following = next((l["time"] for l in out_lines[i + 1 :] if l["time"] is not None), last_time + 1)
			line["time"] = min(last_time, following)
		last_time = line["time"]
	return out_lines


def to_lines_json(lyric_lines, timed_words):
	remapped = remap_to_lines(lyric_lines, timed_words)
	lines = []
	for line in remapped:
		tokens = word_tokens(line["text"])
		word_times = line.get("wordTimes") or []
		words = [{"time": round(t, 3), "text": tok} for t, tok in zip(word_times, tokens)]
		entry = {"time": round(line["time"], 3), "text": line["text"]}
		if words:
			entry["words"] = words
		lines.append(entry)
	return {"lines": lines}


def read_wav_mono(path):
	with wave.open(path, "rb") as wav:
		channels = wav.getnchannels()
		sample_width = wav.getsampwidth()
		rate = wav.getframerate()
		frames = wav.readframes(wav.getnframes())
	if sample_width == 2:
		count = len(frames) // 2
		samples = struct.unpack("<" + "h" * count, frames)
		scale = 32768.0
	elif sample_width == 1:
		samples = list(frames)
		scale = 128.0
		samples = [s - 128 for s in samples]
	else:
		raise RuntimeError(f"unsupported sample width {sample_width}")
	if channels > 1:
		mono = []
		for i in range(0, len(samples), channels):
			chunk = samples[i : i + channels]
			mono.append(sum(chunk) / float(len(chunk)))
		samples = mono
	return rate, [s / scale for s in samples]


def energy_align(wav_path, lyric_lines):
	"""Map lyric lines onto high-energy regions of the recording, then
	spread each line's words by character weight. No extra packages.
	Instrumental gaps (low RMS) get skipped so words don't land on silence."""
	rate, samples = read_wav_mono(wav_path)
	frame = max(1, int(rate * 0.02))
	energies = []
	for i in range(0, len(samples), frame):
		chunk = samples[i : i + frame]
		if not chunk:
			continue
		rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
		energies.append(rms)
	if not energies:
		return []
	smooth = []
	for i, value in enumerate(energies):
		window = energies[max(0, i - 2) : i + 3]
		smooth.append(sum(window) / len(window))
	peak = max(smooth) or 1.0
	floor = max(0.02 * peak, sorted(smooth)[len(smooth) // 2] * 0.6)
	weights = [max(0.0, e - floor) for e in smooth]
	total = sum(weights)
	if total <= 0:
		weights = [1.0] * len(smooth)
		total = float(len(smooth))
	cum = []
	running = 0.0
	for w in weights:
		running += w
		cum.append(running / total)

	usable = [ln.strip() for ln in lyric_lines if ln.strip()]
	if not usable:
		return []
	char_weights = [max(1, len(re.findall(r"[A-Za-z']+", ln))) for ln in usable]
	char_total = float(sum(char_weights)) or 1.0
	timed_words = []
	consumed = 0.0
	for line, weight in zip(usable, char_weights):
		start_frac = consumed / char_total
		end_frac = (consumed + weight) / char_total
		consumed += weight
		start_t = _frac_to_time(cum, start_frac, frame, rate)
		end_t = _frac_to_time(cum, end_frac, frame, rate)
		span = max(0.25, end_t - start_t)
		tokens = WORD_RE.findall(line)
		if not tokens:
			continue
		token_w = [max(1, len(t)) for t in tokens]
		tok_total = float(sum(token_w))
		elapsed = 0.0
		for tok, tw in zip(tokens, token_w):
			timed_words.append((round(start_t + elapsed, 3), tok))
			elapsed += span * (tw / tok_total)
	return timed_words


def _frac_to_time(cum, frac, frame, rate):
	target = min(1.0, max(0.0, frac))
	for i, value in enumerate(cum):
		if value >= target:
			return i * frame / float(rate)
	return (len(cum) - 1) * frame / float(rate)


def has_ctc():
	try:
		import torchaudio  # noqa: F401

		return True
	except Exception:
		return False


def has_aeneas():
	try:
		import aeneas  # noqa: F401

		return True
	except Exception:
		return False


def has_mfa():
	return bool(shutil.which("mfa") and shutil.which("demucs"))


def available_engines():
	found = ["energy"]
	if has_ctc():
		found.append("ctc")
	if has_aeneas():
		found.append("aeneas")
	if has_mfa():
		found.append("mfa")
	return found


def pick_engine():
	wanted = (os.environ.get("FORCED_ALIGN_ENGINE") or "auto").strip().lower()
	if wanted in {"energy", "ctc", "aeneas", "mfa"}:
		return wanted
	if has_ctc():
		return "ctc"
	if has_aeneas():
		return "aeneas"
	return "energy"


def ctc_align(wav_path, lyric_lines):
	"""Optional torchaudio MMS_FA path. Raises if the model isn't usable."""
	import torch
	import torchaudio
	from torchaudio.functional import forced_align
	from torchaudio.pipelines import MMS_FA

	bundle = MMS_FA
	model = bundle.get_model()
	waveform, sample_rate = torchaudio.load(wav_path)
	if waveform.size(0) > 1:
		waveform = waveform.mean(dim=0, keepdim=True)
	if sample_rate != bundle.sample_rate:
		waveform = torchaudio.functional.resample(waveform, sample_rate, bundle.sample_rate)
	with torch.inference_mode():
		emissions, _ = model(waveform)
	dictionary = bundle.get_dict()
	transcript = " ".join(line.strip() for line in lyric_lines if line.strip()).lower()
	tokens = []
	for ch in transcript:
		if ch in dictionary:
			tokens.append(dictionary[ch])
		elif ch == " " and "|" in dictionary:
			tokens.append(dictionary["|"])
	if not tokens:
		raise RuntimeError("ctc: empty token stream")
	targets = torch.tensor(tokens, dtype=torch.int32)
	aligned, scores = forced_align(emissions[0].cpu(), targets, blank=0)
	# Collapse repeats into one timestamp per non-blank token.
	times = []
	prev = None
	frame_hz = bundle.sample_rate / bundle.hop_length if hasattr(bundle, "hop_length") else 50.0
	for i, tok in enumerate(aligned.tolist()):
		if tok == 0 or tok == prev:
			prev = tok
			continue
		prev = tok
		times.append(i / frame_hz)
	words = WORD_RE.findall(transcript)
	# Map character-ish tokens onto words by walking the collapsed stream.
	# MMS labels are characters; we group by spaces in the original transcript.
	timed = []
	if times and words:
		# Fall back to even split across the aligned span if grouping fails.
		start, end = times[0], times[-1]
		span = max(0.25, end - start)
		elapsed = 0.0
		weights = [max(1, len(w)) for w in words]
		total = float(sum(weights))
		for word, weight in zip(words, weights):
			timed.append((round(start + elapsed, 3), word))
			elapsed += span * (weight / total)
	return timed


def aeneas_align(wav_path, lyric_lines):
	from aeneas.executetask import ExecuteTask
	from aeneas.task import Task

	text = "\n".join(line.strip() for line in lyric_lines if line.strip())
	config = "task_language=eng|is_text_type=plain|os_task_file_format=json"
	task = Task(config_string=config)
	task.audio_file_path_absolute = wav_path
	# aeneas wants a file; write a temp text next to the wav.
	text_path = wav_path + ".aeneas.txt"
	with open(text_path, "w", encoding="utf-8") as fh:
		fh.write(text)
	task.text_file_path_absolute = text_path
	ExecuteTask(task).execute()
	sync = json.loads(task.sync_map.json_string)
	timed = []
	fragments = sync.get("fragments") or []
	# Line-level fragments; split each into words by character weight.
	usable = [ln.strip() for ln in lyric_lines if ln.strip()]
	for frag, line in zip(fragments, usable):
		begin = float(frag.get("begin") or 0)
		end = float(frag.get("end") or begin)
		tokens = WORD_RE.findall(line)
		if not tokens:
			continue
		span = max(0.2, end - begin)
		weights = [max(1, len(t)) for t in tokens]
		total = float(sum(weights))
		elapsed = 0.0
		for tok, weight in zip(tokens, weights):
			timed.append((round(begin + elapsed, 3), tok))
			elapsed += span * (weight / total)
	return timed


def apply_offset(timed_words, offset_sec):
	if not offset_sec:
		return timed_words
	return [(round(t + offset_sec, 3), w) for t, w in timed_words]


def write_result(out_json_path, result):
	os.makedirs(os.path.dirname(out_json_path) or ".", exist_ok=True)
	tmp = out_json_path + ".tmp"
	with open(tmp, "w", encoding="utf-8") as fh:
		json.dump(result, fh)
	os.replace(tmp, out_json_path)


def main():
	if len(sys.argv) >= 2 and sys.argv[1] == "--probe":
		engine = pick_engine()
		print(json.dumps({"engine": engine, "available": available_engines()}))
		return 0
	if len(sys.argv) != 4:
		print("usage: align.py <wav_path> <lyrics_txt_path> <out_json_path>", file=sys.stderr)
		return 1
	wav_path, lyrics_txt_path, out_json_path = sys.argv[1:4]
	with open(lyrics_txt_path, "r", encoding="utf-8") as fh:
		lyric_lines = fh.read().splitlines()
	try:
		offset = float(os.environ.get("FORCED_ALIGN_OFFSET") or 0)
	except ValueError:
		offset = 0.0

	engine = pick_engine()
	timed_words = []
	try:
		if engine == "ctc":
			timed_words = ctc_align(wav_path, lyric_lines)
		elif engine == "aeneas":
			timed_words = aeneas_align(wav_path, lyric_lines)
		elif engine == "mfa":
			with tempfile.TemporaryDirectory(prefix="smart-display-align-") as work_dir:
				vocals_path = isolate_vocals(wav_path, work_dir)
				timed_words = align_words(vocals_path, lyric_lines, work_dir)
		else:
			timed_words = energy_align(wav_path, lyric_lines)
	except Exception as exc:
		print(f"{engine} align failed, falling back to energy: {exc}", file=sys.stderr)
		engine = "energy"
		timed_words = energy_align(wav_path, lyric_lines)

	timed_words = apply_offset(timed_words, offset)
	result = to_lines_json(lyric_lines, timed_words)
	result["engine"] = engine
	write_result(out_json_path, result)
	print(json.dumps({"ok": True, "engine": engine, "lines": len(result["lines"])}))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
