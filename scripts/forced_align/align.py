#!/usr/bin/env python3
"""On-device word alignment: given a recording of the track and the lyric
text, emit a start (and end) clock for every word.

Engines, best first. FORCED_ALIGN_ENGINE=auto picks the first one that is
installed, never MFA unless asked (Demucs+MFA is too heavy for the kiosk):

	qwen    - Qwen3-ForcedAligner-0.6B via the qwen-asr package. Single
	          non-autoregressive pass, ~40 ms mean error, 11 languages.
	ctc     - torchaudio MMS_FA (wav2vec2 CTC) Viterbi alignment, 20 ms frames.
	aeneas  - DTW aligner, line-level fragments split by syllable weight.
	mfa     - Demucs vocals + Montreal Forced Aligner (opt-in).
	energy  - stdlib RMS envelope vs lyric weights. Always available; a
	          stand-in, not a measurement.

qwen / ctc / aeneas / mfa are "precise": their clocks come from an acoustic
model, so lyrics.js lets them override community word timing. energy is
not, so it only fills in when nobody published word clocks.

Usage:
	python3 align.py --probe
	python3 align.py <wav_path> <lyrics_txt_path> <out_json_path>

Env:
	FORCED_ALIGN_ENGINE      auto | qwen | ctc | aeneas | mfa | energy
	FORCED_ALIGN_OFFSET      seconds to add when recording began mid-track
	FORCED_ALIGN_LANGUAGE    qwen language name (default English)
	FORCED_ALIGN_DEVICE      cuda | cuda:0 | cpu (default: cuda if available)
	FORCED_ALIGN_QWEN_MODEL  HF id / local dir (default Qwen/Qwen3-ForcedAligner-0.6B)
	FORCED_ALIGN_QWEN_MAX_SEC audio per qwen pass before chunking (default 240)
	FORCED_ALIGN_SEPARATE    auto | 1 | 0: run Demucs before qwen/ctc when installed
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
WORD_RE = re.compile(r"[A-Za-z0-9']+")
PRECISE_ENGINES = {"qwen", "ctc", "aeneas", "mfa"}
QWEN_DEFAULT_MODEL = "Qwen/Qwen3-ForcedAligner-0.6B"
QWEN_DEFAULT_MAX_SEC = 240.0
QWEN_ASSIGN_SLACK_SEC = 12.0
CTC_CHUNK_SEC = 30.0


def run(cmd, **kw):
	print(f"+ {' '.join(cmd)}", file=sys.stderr, flush=True)
	subprocess.run(cmd, check=True, **kw)


def log(msg):
	print(msg, file=sys.stderr, flush=True)


def isolate_vocals(wav_path, work_dir):
	out_dir = os.path.join(work_dir, "demucs")
	run(["demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", out_dir, wav_path])
	stem = os.path.splitext(os.path.basename(wav_path))[0]
	vocals = os.path.join(out_dir, "htdemucs", stem, "vocals.wav")
	if not os.path.exists(vocals):
		raise FileNotFoundError(f"demucs did not produce {vocals}")
	return vocals


def word_tokens(text, *, lower=True):
	tokens = WORD_RE.findall(text or "")
	return [tok.lower() for tok in tokens] if lower else list(tokens)


def usable_lines(lyric_lines):
	return [ln.strip() for ln in lyric_lines if ln.strip()]


# ---------------------------------------------------------------- output


def remap_to_lines(lyric_lines, timed_words):
	"""Aligners see one flat word stream; this walks it back against the
	original line breaks so the UI still shows the full lyric text. Matching
	is by normalized token, not a one-shot cursor: if Qwen splits, merges, or
	drops a word, leftover tokens stay on their line instead of truncating
	"I walk a lonely road" to "i walk a". `timed_words` items are
	(start, word) or (start, word, end)."""
	groups = []
	expected = []
	for line in lyric_lines:
		text = line.strip()
		toks = word_tokens(text, lower=False) if text else []
		groups.append((text, toks))
		expected.extend(tok.lower() for tok in toks)

	units = []
	for item in timed_words or []:
		start = float(item[0] or 0.0)
		word = item[1]
		end = item[2] if len(item) > 2 else None
		end = float(end) if end is not None else start
		units.append({"text": word, "start": start, "end": max(start, end)})
	matched = match_qwen_units(expected, units) if expected else []

	cursor = 0
	out_lines = []
	for text, toks in groups:
		if not text:
			out_lines.append({"time": None, "text": "", "words": []})
			continue
		chunk = matched[cursor : cursor + len(toks)]
		cursor += len(toks)
		words = []
		for (start, _tok, end), original in zip(chunk, toks):
			words.append((start, end, original))
		out_lines.append({"time": words[0][0] if words else None, "text": text, "words": words})

	last_time = 0.0
	for i, line in enumerate(out_lines):
		if line["time"] is None:
			following = next((l["time"] for l in out_lines[i + 1 :] if l["time"] is not None), last_time + 1)
			line["time"] = min(last_time, following) if last_time else following
		last_time = line["time"]
	return out_lines


def to_lines_json(lyric_lines, timed_words):
	remapped = remap_to_lines(lyric_lines, timed_words)
	lines = []
	for line in remapped:
		words = []
		for item in line["words"]:
			start, end, tok = item[0], item[1], item[2]
			word = {"time": round(start, 3), "text": tok}
			if end is not None and end > start:
				word["end"] = round(end, 3)
			words.append(word)
		entry = {"time": round(line["time"] or 0.0, 3), "text": line["text"]}
		if words:
			entry["words"] = words
			last_end = words[-1].get("end")
			if last_end is not None:
				entry["end"] = last_end
		lines.append(entry)
	return {"lines": lines}


def spread_words(tokens, start, end):
	"""Distribute `tokens` across [start, end] by character weight, returning
	(start, word, end) triples. Shared by the line-level engines."""
	span = max(0.2, end - start)
	weights = [max(1, len(t)) for t in tokens]
	total = float(sum(weights)) or 1.0
	elapsed = 0.0
	out = []
	for tok, weight in zip(tokens, weights):
		word_start = start + elapsed
		elapsed += span * (weight / total)
		out.append((round(word_start, 3), tok, round(start + elapsed, 3)))
	return out


# ----------------------------------------------------------------- audio


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
		samples = [s - 128 for s in frames]
		scale = 128.0
	else:
		raise RuntimeError(f"unsupported sample width {sample_width}")
	if channels > 1:
		mono = []
		for i in range(0, len(samples), channels):
			chunk = samples[i : i + channels]
			mono.append(sum(chunk) / float(len(chunk)))
		samples = mono
	return rate, [s / scale for s in samples]


def rms_envelope(samples, rate, hop_sec=0.02):
	frame = max(1, int(rate * hop_sec))
	energies = []
	for i in range(0, len(samples), frame):
		chunk = samples[i : i + frame]
		if not chunk:
			continue
		energies.append(math.sqrt(sum(s * s for s in chunk) / len(chunk)))
	smooth = []
	for i, _value in enumerate(energies):
		window = energies[max(0, i - 2) : i + 3]
		smooth.append(sum(window) / len(window))
	return frame, smooth


def quiet_split_points(samples, rate, max_sec, min_sec=20.0):
	"""Cut a long recording into <= max_sec pieces at its quietest moments
	(so a cut lands in an instrumental gap, not mid-word). Returns segment
	(start_sec, end_sec) pairs covering the whole recording."""
	total_sec = len(samples) / float(rate)
	if total_sec <= max_sec:
		return [(0.0, total_sec)]
	frame, env = rms_envelope(samples, rate)
	hop = frame / float(rate)
	# Score each frame by the mean energy of the ~300 ms around it, so the
	# cut lands in the middle of a real gap rather than on one lucky quiet
	# frame at the edge of a word.
	half = max(1, int(0.15 / hop))
	prefix = [0.0]
	for value in env:
		prefix.append(prefix[-1] + value)

	def gap_score(i):
		lo_i = max(0, i - half)
		hi_i = min(len(env), i + half + 1)
		return (prefix[hi_i] - prefix[lo_i]) / float(hi_i - lo_i)

	segments = []
	start = 0.0
	while total_sec - start > max_sec:
		hi = start + max_sec
		lo = min(start + max(min_sec, max_sec * 0.5), hi - 1.0)
		lo_i = int(lo / hop)
		hi_i = min(len(env) - 1, int(hi / hop))
		if hi_i <= lo_i:
			cut = hi
		else:
			best = min(range(lo_i, hi_i + 1), key=gap_score)
			cut = best * hop
		segments.append((start, cut))
		start = cut
	segments.append((start, total_sec))
	return segments


# ---------------------------------------------------------------- energy


def energy_align(wav_path, lyric_lines):
	"""Map lyric lines onto high-energy regions of the recording, then
	spread each line's words by character weight. No extra packages.
	Instrumental gaps (low RMS) get skipped so words don't land on silence."""
	rate, samples = read_wav_mono(wav_path)
	return energy_align_samples(rate, samples, lyric_lines)


def energy_align_samples(rate, samples, lyric_lines):
	frame, smooth = rms_envelope(samples, rate)
	if not smooth:
		return []
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

	usable = usable_lines(lyric_lines)
	if not usable:
		return []
	line_weights = [max(1, len(WORD_RE.findall(ln))) for ln in usable]
	line_total = float(sum(line_weights)) or 1.0
	timed_words = []
	consumed = 0.0
	for line, weight in zip(usable, line_weights):
		start_frac = consumed / line_total
		end_frac = (consumed + weight) / line_total
		consumed += weight
		start_t = _frac_to_time(cum, start_frac, frame, rate)
		end_t = _frac_to_time(cum, end_frac, frame, rate)
		tokens = word_tokens(line)
		if not tokens:
			continue
		timed_words.extend(spread_words(tokens, start_t, max(start_t + 0.25, end_t)))
	return timed_words


def _frac_to_time(cum, frac, frame, rate):
	target = min(1.0, max(0.0, frac))
	for i, value in enumerate(cum):
		# Strictly greater so frac 0 lands where energy begins, not at 0:00
		# of a track with a quiet intro.
		if value > target or (target >= 1.0 and value >= 1.0):
			return i * frame / float(rate)
	return (len(cum) - 1) * frame / float(rate)


# ------------------------------------------------------------ discovery


def has_qwen():
	try:
		import qwen_asr  # noqa: F401

		return True
	except Exception:
		return False


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
	found = []
	if has_qwen():
		found.append("qwen")
	if has_ctc():
		found.append("ctc")
	if has_aeneas():
		found.append("aeneas")
	if has_mfa():
		found.append("mfa")
	found.append("energy")
	return found


def pick_engine():
	wanted = (os.environ.get("FORCED_ALIGN_ENGINE") or "auto").strip().lower()
	if wanted in {"energy", "qwen", "ctc", "aeneas", "mfa"}:
		return wanted
	if has_qwen():
		return "qwen"
	if has_ctc():
		return "ctc"
	if has_aeneas():
		return "aeneas"
	return "energy"


def pick_device():
	wanted = (os.environ.get("FORCED_ALIGN_DEVICE") or "").strip()
	if wanted:
		return wanted
	try:
		import torch

		return "cuda:0" if torch.cuda.is_available() else "cpu"
	except Exception:
		return "cpu"


def want_separation(engine):
	mode = (os.environ.get("FORCED_ALIGN_SEPARATE") or "auto").strip().lower()
	if mode in {"0", "no", "off", "false"}:
		return False
	if mode in {"1", "yes", "on", "true"}:
		return bool(shutil.which("demucs"))
	return engine in {"qwen", "ctc"} and bool(shutil.which("demucs"))


# ------------------------------------------------------------------ qwen


def _item_field(item, *names):
	for name in names:
		if isinstance(item, dict) and name in item:
			return item[name]
		if hasattr(item, name):
			return getattr(item, name)
	return None


def match_qwen_units(tokens, units):
	"""Zip the aligner's returned units back onto our tokens. Counts match
	when the aligner keeps our whitespace tokenization; if it split or merged
	something, walk both lists by normalized text and fill any token the
	aligner skipped from its neighbors."""
	timed = [None] * len(tokens)

	def norm(value):
		return re.sub(r"[^a-z0-9']", "", str(value or "").lower())

	def clocks(unit):
		start = float(_item_field(unit, "start_time", "start") or 0.0)
		end = float(_item_field(unit, "end_time", "end") or 0.0)
		return (start, max(start, end))

	if len(units) == len(tokens):
		for i, unit in enumerate(units):
			timed[i] = clocks(unit)
	else:
		u = 0
		for i, tok in enumerate(tokens):
			target = norm(tok)
			j = u
			while j < len(units) and j < u + 6:
				if norm(_item_field(units[j], "text", "word")) == target:
					break
				j += 1
			if j < len(units) and j < u + 6:
				timed[i] = clocks(units[j])
				u = j + 1
	# Fill gaps: a skipped token borrows the end of the previous timed word
	# and the start of the next one.
	out = []
	for i, tok in enumerate(tokens):
		if timed[i] is not None:
			out.append((round(timed[i][0], 3), tok, round(timed[i][1], 3)))
			continue
		prev_end = next((timed[j][1] for j in range(i - 1, -1, -1) if timed[j] is not None), 0.0)
		next_start = next((timed[j][0] for j in range(i + 1, len(tokens)) if timed[j] is not None), prev_end + 0.3)
		out.append((round(prev_end, 3), tok, round(max(prev_end, next_start), 3)))
	return out


def lines_for_segments(usable, coarse_words, segments, slack=0.0):
	"""Assign each lyric line to the audio segment its coarse (energy) start
	falls in, so a long track can be aligned in pieces. `slack` keeps a line
	in the earlier segment when its coarse clock sits within that many
	seconds past the cut; qwen_align's carry-over then moves it forward if
	the aligner finds its audio is not there. Lines with no coarse clock
	follow the previous line."""
	groups = [[] for _ in segments]
	cursor = 0
	seg_idx = 0
	for line in usable:
		tokens = word_tokens(line)
		start = None
		if tokens and cursor < len(coarse_words):
			start = coarse_words[cursor][0]
		cursor += len(tokens)
		if start is not None:
			while seg_idx + 1 < len(segments) and start >= segments[seg_idx][1] + slack:
				seg_idx += 1
		groups[seg_idx].append(line)
	return groups


def line_overflowed(words, piece_sec, margin=0.3):
	"""True when the aligner pushed a line against the end of the clip: its
	first word starts in the last `margin` seconds, or most of its words are
	zero-length (the LIS step collapses text it found no audio for)."""
	if not words:
		return True
	first_start = words[0][0]
	if first_start >= piece_sec - margin:
		return True
	flat = sum(1 for start, _tok, end in words if end - start <= 1e-6)
	return flat * 2 >= len(words)


def qwen_align(wav_path, lyric_lines):
	"""Qwen3-ForcedAligner: one forward pass per <= max_sec chunk. The
	model is reliable to roughly 270 s, so a longer recording is cut at its
	quietest gaps and each piece aligned with the lines an energy pre-pass
	places inside it."""
	import numpy as np
	import torch
	from qwen_asr import Qwen3ForcedAligner

	rate, samples = read_wav_mono(wav_path)
	usable = usable_lines(lyric_lines)
	if not usable or not samples:
		return []
	try:
		max_sec = float(os.environ.get("FORCED_ALIGN_QWEN_MAX_SEC") or QWEN_DEFAULT_MAX_SEC)
	except ValueError:
		max_sec = QWEN_DEFAULT_MAX_SEC
	segments = quiet_split_points(samples, rate, max_sec)
	if len(segments) > 1:
		coarse = energy_align_samples(rate, samples, usable)
		groups = lines_for_segments(usable, coarse, segments, slack=QWEN_ASSIGN_SLACK_SEC)
	else:
		groups = [usable]

	device = pick_device()
	dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
	model = Qwen3ForcedAligner.from_pretrained(
		os.environ.get("FORCED_ALIGN_QWEN_MODEL") or QWEN_DEFAULT_MODEL,
		dtype=dtype,
		device_map=device,
	)
	language = os.environ.get("FORCED_ALIGN_LANGUAGE") or "English"
	audio = np.asarray(samples, dtype=np.float32)

	def align_piece(seg_start, seg_end, lines):
		"""Returns per-line (start, word, end) lists, clocks relative to the piece."""
		piece = audio[int(seg_start * rate) : int(seg_end * rate)]
		tokens = [word_tokens(line) for line in lines]
		flat = [tok for group in tokens for tok in group]
		if piece.size == 0 or not flat:
			return [[] for _ in lines]
		results = model.align(audio=(piece, rate), text=" ".join(flat), language=language)
		units = list(results[0]) if results else []
		matched = match_qwen_units(flat, units)
		per_line = []
		cursor = 0
		for group in tokens:
			per_line.append(matched[cursor : cursor + len(group)])
			cursor += len(group)
		return per_line

	# The coarse pass over-assigns lines to the earlier piece (slack above);
	# whatever the aligner then squashes against that piece's end had no
	# audio there and is carried into the next piece.
	timed = []
	carry = []
	for idx, ((seg_start, seg_end), assigned) in enumerate(zip(segments, groups)):
		lines = carry + assigned
		carry = []
		if not lines:
			continue
		per_line = align_piece(seg_start, seg_end, lines)
		last_piece = idx + 1 >= len(segments)
		if not last_piece:
			piece_sec = seg_end - seg_start
			while len(lines) > 1 and line_overflowed(per_line[-1], piece_sec):
				carry.insert(0, lines.pop())
				per_line.pop()
			if carry:
				log(f"qwen: {len(carry)} line(s) carried past {seg_end:.1f}s")
				per_line = align_piece(seg_start, seg_end, lines)
		for words in per_line:
			for start, tok, end in words:
				timed.append((round(start + seg_start, 3), tok, round(end + seg_start, 3)))
	return timed


# ------------------------------------------------------------------- ctc


def ctc_align(wav_path, lyric_lines):
	"""torchaudio MMS_FA: wav2vec2 CTC emissions (computed in 30 s chunks so
	a full song fits in CPU memory) plus Viterbi forced alignment over the
	whole transcript, then token spans merged per word. 20 ms frames."""
	import torch
	import torchaudio
	from torchaudio.functional import forced_align, merge_tokens

	bundle = torchaudio.pipelines.MMS_FA
	model = bundle.get_model()
	# The stdlib WAV reader instead of torchaudio.load: the latter now wants
	# torchcodec/ffmpeg bindings, and parec already hands us plain PCM WAV.
	sample_rate, samples = read_wav_mono(wav_path)
	waveform = torch.tensor(samples, dtype=torch.float32).unsqueeze(0)
	if sample_rate != bundle.sample_rate:
		waveform = torchaudio.functional.resample(waveform, sample_rate, bundle.sample_rate)
		sample_rate = bundle.sample_rate
	try:
		dictionary = bundle.get_dict(star=None)
	except TypeError:
		dictionary = bundle.get_dict()

	usable = usable_lines(lyric_lines)
	words = []
	for line in usable:
		words.extend(word_tokens(line))
	token_groups = []
	kept_words = []
	for word in words:
		ids = [dictionary[ch] for ch in word if ch in dictionary]
		if ids:
			token_groups.append(ids)
			kept_words.append(word)
	if not token_groups:
		raise RuntimeError("ctc: transcript has no alignable characters")

	chunk = int(CTC_CHUNK_SEC * sample_rate)
	pieces = []
	with torch.inference_mode():
		for lo in range(0, waveform.size(1), chunk):
			emission, _ = model(waveform[:, lo : lo + chunk])
			pieces.append(emission[0].cpu())
	emissions = torch.cat(pieces, dim=0)
	frames_per_sec = emissions.size(0) / (waveform.size(1) / float(sample_rate))

	flat = [tok for group in token_groups for tok in group]
	targets = torch.tensor(flat, dtype=torch.int32).unsqueeze(0)
	aligned, scores = forced_align(emissions.unsqueeze(0), targets, blank=0)
	spans = merge_tokens(aligned[0], scores[0].exp())
	if len(spans) != len(flat):
		raise RuntimeError(f"ctc: {len(spans)} spans for {len(flat)} tokens")

	timed = []
	cursor = 0
	for word, group in zip(kept_words, token_groups):
		word_spans = spans[cursor : cursor + len(group)]
		cursor += len(group)
		start = word_spans[0].start / frames_per_sec
		end = word_spans[-1].end / frames_per_sec
		timed.append((round(start, 3), word, round(max(end, start + 0.04), 3)))

	if len(kept_words) != len(words):
		# Words made only of characters outside the model's alphabet were
		# skipped for alignment; give them a slot between their neighbors.
		merged = []
		k = 0
		for word in words:
			if k < len(kept_words) and kept_words[k] == word:
				merged.append(timed[k])
				k += 1
			else:
				prev_end = merged[-1][2] if merged else 0.0
				next_start = timed[k][0] if k < len(timed) else prev_end + 0.3
				merged.append((round(prev_end, 3), word, round(max(prev_end, next_start), 3)))
		timed = merged
	return timed


# ---------------------------------------------------------------- aeneas


def aeneas_align(wav_path, lyric_lines):
	from aeneas.executetask import ExecuteTask
	from aeneas.task import Task

	usable = usable_lines(lyric_lines)
	text = "\n".join(usable)
	config = "task_language=eng|is_text_type=plain|os_task_file_format=json"
	task = Task(config_string=config)
	task.audio_file_path_absolute = wav_path
	text_path = wav_path + ".aeneas.txt"
	with open(text_path, "w", encoding="utf-8") as fh:
		fh.write(text)
	task.text_file_path_absolute = text_path
	ExecuteTask(task).execute()
	sync = json.loads(task.sync_map.json_string)
	timed = []
	fragments = sync.get("fragments") or []
	for frag, line in zip(fragments, usable):
		begin = float(frag.get("begin") or 0)
		end = float(frag.get("end") or begin)
		tokens = word_tokens(line)
		if not tokens:
			continue
		timed.extend(spread_words(tokens, begin, end))
	return timed


# ------------------------------------------------------------------- mfa


def mfa_align_words(vocals_path, lyric_lines, work_dir):
	"""Runs MFA on the vocal stem against the flattened lyric text and
	returns (start, word, end) triples."""
	corpus_dir = os.path.join(work_dir, "corpus")
	out_dir = os.path.join(work_dir, "mfa_out")
	os.makedirs(corpus_dir, exist_ok=True)
	base = "track"
	shutil.copy(vocals_path, os.path.join(corpus_dir, f"{base}.wav"))
	flat_text = " ".join(usable_lines(lyric_lines))
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
		(interval.minTime, interval.mark.strip(), interval.maxTime)
		for interval in word_tier.intervals
		if interval.mark and interval.mark.strip().lower() not in SILENCE_MARKS
	]


# ------------------------------------------------------------------ main


def apply_offset(timed_words, offset_sec):
	if not offset_sec:
		return timed_words
	out = []
	for item in timed_words:
		start, word = item[0], item[1]
		end = item[2] if len(item) > 2 else None
		out.append((round(start + offset_sec, 3), word, None if end is None else round(end + offset_sec, 3)))
	return out


def write_result(out_json_path, result):
	os.makedirs(os.path.dirname(out_json_path) or ".", exist_ok=True)
	tmp = out_json_path + ".tmp"
	with open(tmp, "w", encoding="utf-8") as fh:
		json.dump(result, fh)
	os.replace(tmp, out_json_path)


def align_with(engine, wav_path, lyric_lines, work_dir):
	source = wav_path
	if engine in {"qwen", "ctc"} and want_separation(engine):
		try:
			source = isolate_vocals(wav_path, work_dir)
		except Exception as exc:  # demucs is optional; the mix still aligns
			log(f"vocal separation skipped: {exc}")
			source = wav_path
	if engine == "qwen":
		return qwen_align(source, lyric_lines)
	if engine == "ctc":
		return ctc_align(source, lyric_lines)
	if engine == "aeneas":
		return aeneas_align(source, lyric_lines)
	if engine == "mfa":
		vocals_path = isolate_vocals(wav_path, work_dir)
		return mfa_align_words(vocals_path, lyric_lines, work_dir)
	return energy_align(wav_path, lyric_lines)


def self_test():
	class Unit:
		def __init__(self, text, start, end):
			self.text = text
			self.start_time = start
			self.end_time = end

	# 1:1 unit match keeps the aligner's clocks verbatim.
	exact = match_qwen_units(["hello", "there"], [Unit("hello", 0.5, 0.9), Unit("there", 1.0, 1.4)])
	assert exact == [(0.5, "hello", 0.9), (1.0, "there", 1.4)]
	# A token the aligner skipped borrows its neighbors' clocks.
	gap = match_qwen_units(["hello", "my", "friend"], [Unit("hello", 0.5, 0.9), Unit("friend", 1.4, 1.9)])
	assert gap[0] == (0.5, "hello", 0.9)
	assert gap[1] == (0.9, "my", 1.4)
	assert gap[2] == (1.4, "friend", 1.9)
	# Dict-shaped units work too.
	dicts = match_qwen_units(["a", "b"], [{"text": "a", "start": 0.0, "end": 0.2}, {"text": "b", "start": 0.3, "end": 0.5}])
	assert dicts[1] == (0.3, "b", 0.5)

	# A recording under the limit is one segment; a long one is cut at the quietest gap.
	rate = 1000
	quiet = [0.0] * (rate * 5)
	loud = [0.5 * math.sin(i / 3.0) for i in range(rate * 20)]
	samples = loud + quiet + loud
	assert quiet_split_points(samples, rate, 60.0) == [(0.0, 45.0)]
	segments = quiet_split_points(samples, rate, 30.0, min_sec=5.0)
	assert len(segments) == 2
	assert 20.0 <= segments[0][1] <= 25.0, segments
	assert segments[-1][1] == 45.0

	# Lines follow their coarse clocks into the right segment.
	coarse = [(1.0, "one", 1.5), (2.0, "two", 2.5), (30.0, "three", 30.5), (31.0, "four", 31.5)]
	groups = lines_for_segments(["one two", "three four"], coarse, [(0.0, 22.0), (22.0, 45.0)])
	assert groups == [["one two"], ["three four"]]
	# With slack a line just past the cut stays in the earlier piece.
	near = [(1.0, "one", 1.5), (2.0, "two", 2.5), (25.0, "three", 25.5), (26.0, "four", 26.5)]
	assert lines_for_segments(["one two", "three four"], near, [(0.0, 22.0), (22.0, 45.0)], slack=12.0) == [["one two", "three four"], []]
	# A line squashed against the end of a piece, or collapsed to zero-length words, overflowed.
	assert line_overflowed([(19.8, "a", 19.9), (19.9, "b", 20.0)], 20.0) is True
	assert line_overflowed([(12.0, "a", 12.0), (12.0, "b", 12.0), (12.0, "c", 12.5)], 20.0) is True
	assert line_overflowed([(12.0, "a", 12.3), (12.4, "b", 12.9)], 20.0) is False
	assert line_overflowed([], 20.0) is True

	# Line remap keeps word ends, original spelling, and fills a blank line's clock.
	result = to_lines_json(["hello there", "", "friend"], [(0.5, "hello", 0.9), (1.0, "there", 1.4), (2.0, "friend", 2.6)])
	assert result["lines"][0]["end"] == 1.4
	assert result["lines"][0]["words"][1] == {"time": 1.0, "text": "there", "end": 1.4}
	assert result["lines"][1]["text"] == ""
	assert result["lines"][2]["time"] == 2.0
	# A short aligner stream must not clip the original line to "i walk a".
	short = to_lines_json(
		["I walk a lonely road"],
		[(0.5, "i", 0.7), (0.7, "walk", 0.9), (0.9, "a", 1.1)],
	)
	assert short["lines"][0]["text"] == "I walk a lonely road"
	assert [w["text"] for w in short["lines"][0]["words"]] == ["I", "walk", "a", "lonely", "road"]
	assert apply_offset([(1.0, "a", 1.5)], 2.0) == [(3.0, "a", 3.5)]
	assert "energy" in available_engines()
	assert "energy" not in PRECISE_ENGINES and "qwen" in PRECISE_ENGINES
	print(json.dumps({"ok": True, "tests": 9}))
	return 0


def main():
	if len(sys.argv) >= 2 and sys.argv[1] == "--self-test":
		return self_test()
	if len(sys.argv) >= 2 and sys.argv[1] == "--probe":
		engine = pick_engine()
		print(
			json.dumps(
				{
					"engine": engine,
					"precise": engine in PRECISE_ENGINES,
					"available": available_engines(),
					"device": pick_device() if engine in {"qwen", "ctc"} else None,
					"separate": want_separation(engine),
				}
			)
		)
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
	with tempfile.TemporaryDirectory(prefix="smart-display-align-") as work_dir:
		try:
			timed_words = align_with(engine, wav_path, lyric_lines, work_dir)
			if not timed_words:
				raise RuntimeError("no words aligned")
		except Exception as exc:
			log(f"{engine} align failed, falling back to energy: {exc}")
			engine = "energy"
			timed_words = energy_align(wav_path, lyric_lines)

	timed_words = apply_offset(timed_words, offset)
	result = to_lines_json(lyric_lines, timed_words)
	result["engine"] = engine
	result["precise"] = engine in PRECISE_ENGINES
	write_result(out_json_path, result)
	print(json.dumps({"ok": True, "engine": engine, "precise": result["precise"], "lines": len(result["lines"])}))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
