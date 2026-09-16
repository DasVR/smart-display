#!/usr/bin/env python3
"""Forced-alignment fallback for songs with no synced lyrics anywhere
online: isolate vocals with Demucs, then align the known plain lyric text
to that vocal stem with the Montreal Forced Aligner (MFA) to get
word-level timestamps.

This is the last-resort tier, run by src/lib/server/forcedAlign.js only
after LRCLIB and the syncedlyrics fallback both come up empty, and only
once per track (the result is cached to disk and reused on every later
play). It is heavy - a few minutes of CPU per song - which is why it never
runs inline with a request; it runs in the background against a full
play-through recording and simply isn't ready yet the first time a song is
played.

One-time setup (not run automatically - conda-based, with a one-off model
download):
	conda create -n smart-display-align python=3.10
	conda activate smart-display-align
	pip install demucs
	conda install -c conda-forge montreal-forced-aligner
	mfa model download acoustic english_us_arpa
	mfa model download dictionary english_us_arpa

Then point smart-display at that env's `python3`/`demucs`/`mfa` binaries,
e.g. via LYRICS_PYTHON_BIN and PATH, before starting ws-server.js.

Usage:
	python3 align.py <wav_path> <lyrics_txt_path> <out_json_path>

<lyrics_txt_path> is the plain lyric text, one sung line per line - the
same line breaks the output JSON preserves. <out_json_path> is written
atomically (write to .tmp, then rename) as:
	{"lines": [{"time": 12.34, "text": "...", "words": [{"time": 12.34, "text": "..."}]}]}
matching the shape lyrics.js's parseLRC()/parseTTML() already produce, so
the UI doesn't need to know a line came from forced alignment.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

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


def main():
	if len(sys.argv) != 4:
		print("usage: align.py <wav_path> <lyrics_txt_path> <out_json_path>", file=sys.stderr)
		return 1
	wav_path, lyrics_txt_path, out_json_path = sys.argv[1:4]
	with open(lyrics_txt_path, "r", encoding="utf-8") as fh:
		lyric_lines = fh.read().splitlines()

	with tempfile.TemporaryDirectory(prefix="smart-display-align-") as work_dir:
		vocals_path = isolate_vocals(wav_path, work_dir)
		timed_words = align_words(vocals_path, lyric_lines, work_dir)

	result = to_lines_json(lyric_lines, timed_words)
	os.makedirs(os.path.dirname(out_json_path) or ".", exist_ok=True)
	tmp = out_json_path + ".tmp"
	with open(tmp, "w", encoding="utf-8") as fh:
		json.dump(result, fh)
	os.replace(tmp, out_json_path)
	print(json.dumps({"ok": True, "lines": len(result["lines"])}))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
