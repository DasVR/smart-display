#!/usr/bin/env python3
"""Community word-synced lyric lookup.

Walks several free, keyless sources that actually publish per-word (or
per-syllable) timing, then falls back to line-synced LRC. Used by
syncedlyrics_lookup.py.

Order (first word-level hit with a matching artist/title wins):
  1. AMLL TTML DB (https://api.amll.dev) - community Apple-Music-like TTML
  2. NetEase Cloud Music YRC - per-word karaoke
  3. Kugou KRC - per-word karaoke (XOR+zlib, same decode every open lyric app uses)
  4. syncedlyrics with enhanced=True (Musixmatch word-level, then line LRC)

None of these need a paid API key. Failures are swallowed so the Node
caller can fall through to LRCLIB / on-device alignment.
"""
from __future__ import annotations

import base64
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "smart-display/1.0 (https://github.com/DasVR/smart-display)"
NETEASE_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
KUGOU_KEY = bytes(
	[0x40, 0x47, 0x61, 0x77, 0x5E, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2D, 0xCE, 0xD2, 0x6E, 0x69]
)
FEAT_RE = re.compile(r"\b(feat|ft|featuring|with)\b.*$", re.I)
YRC_WORD_RE = re.compile(r"\((\d+),(\d+),(\d+)\)([^(]*)")
KRC_LINE_RE = re.compile(r"^\[(\d+),(\d+)\](.*)$")
KRC_WORD_RE = re.compile(r"<(\d+),(\d+),(\d+)>([^<]*)")
META_LINE_RE = re.compile(r"^\s*\[(ar|ti|al|by|offset|id|language|hash):", re.I)
CREDIT_LINE_RE = re.compile(
	r"^(作词|作詞|作曲|编曲|編曲|制作人|製作人|歌词|歌詞|演唱|歌手|出品|produced\s*by|written\s*by|lyrics\s*by|lyricist|composer|arranger|lyrics|composer)\s*[:：]",
	re.I,
)
TRAILING_CREDIT_RE = re.compile(
	r"^(lrc\s*by|lyrics\s+provided|provided\s+by|copyright|all rights reserved|thanks for listening)\b",
	re.I,
)
WHOLE_LINE_CREDIT_RE = re.compile(r"^(the end|end|fin)\.?$", re.I)
MARK_CREDIT_RE = re.compile(r"©|℗|网易云|酷狗音乐|qq音乐")


def normalize(value: str = "") -> str:
	text = str(value or "").lower()
	text = text.replace("&", " and ")
	text = FEAT_RE.sub(" ", text)
	text = re.sub(r"[^\w\s]", " ", text)
	return re.sub(r"\s+", " ", text).strip()


def score_hit(got_artist, got_title, got_duration, want) -> int:
	want_title = normalize(want.get("title"))
	want_artist = normalize(want.get("artist"))
	got_title_n = normalize(got_title)
	got_artist_n = normalize(got_artist)
	if not want_title or not got_title_n or got_title_n != want_title:
		return 0
	if not want_artist or not got_artist_n:
		return 0
	if not (got_artist_n in want_artist or want_artist in got_artist_n):
		return 0
	score = 70
	if got_artist_n == want_artist:
		score += 20
	want_dur = float(want.get("duration") or 0)
	got_dur = float(got_duration or 0)
	if want_dur and got_dur:
		delta = abs(want_dur - got_dur)
		if delta <= 2:
			score += 20
		elif delta <= 8:
			score += 10
		elif delta > 30:
			score -= 40
	return score


def http_json(url, *, data=None, headers=None, timeout=6):
	hdrs = {"User-Agent": UA, "Accept": "application/json"}
	if headers:
		hdrs.update(headers)
	body = None
	if data is not None:
		body = urllib.parse.urlencode(data).encode()
		hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
	req = urllib.request.Request(url, data=body, headers=hdrs)
	with urllib.request.urlopen(req, timeout=timeout) as resp:
		raw = resp.read()
	return json.loads(raw.decode("utf-8"))


def is_track_header_line(text, want) -> bool:
	n = normalize(text)
	title = normalize((want or {}).get("title"))
	artist = normalize((want or {}).get("artist"))
	if not n or not title:
		return False
	if n == title:
		return True
	if artist and n in (f"{title} {artist}", f"{artist} {title}"):
		return True
	if artist and n.startswith(title) and n.endswith(artist) and len(n) > len(title) + len(artist):
		return True
	return False


def is_trailing_credit_line(text: str) -> bool:
	raw = str(text or "").strip()
	if not raw:
		return False
	if CREDIT_LINE_RE.search(raw) or TRAILING_CREDIT_RE.search(raw):
		return True
	if WHOLE_LINE_CREDIT_RE.search(raw):
		return True
	return bool(MARK_CREDIT_RE.search(raw))


def drop_non_lyric_lines(lines, want=None):
	"""Strip credit/title headers and trailing provider stamps. Blank instrumental rows stay."""
	cleaned = []
	for line in lines or []:
		text = str(line.get("text") or "").strip()
		if not text:
			cleaned.append(line)
			continue
		if is_trailing_credit_line(text):
			continue
		if not is_track_header_line(text, want or {}):
			cleaned.append(line)
			continue
		n = normalize(text)
		title = normalize((want or {}).get("title"))
		artist = normalize((want or {}).get("artist"))
		if artist and n != title:
			continue
		if float(line.get("time") or 0) < 3:
			continue
		cleaned.append(line)
	return cleaned


def timed_word(time, text, end=None):
	word = {"time": round(time, 3), "text": text}
	if end is not None and float(end) > float(time):
		word["end"] = round(float(end), 3)
	return word


def empty_result(source=None, error=None):
	return {
		"source": source,
		"format": None,
		"wordLevel": False,
		"lines": None,
		"ttml": None,
		"yrc": None,
		"krc": None,
		"synced": None,
		"plain": None,
		"artist": None,
		"title": None,
		"duration": None,
		"error": error,
		"score": 0,
	}


def lines_to_plain(lines):
	if not lines:
		return None
	texts = [str(line.get("text") or "").strip() for line in lines if str(line.get("text") or "").strip()]
	return "\n".join(texts) if texts else None


def parse_yrc(text: str):
	"""NetEase YRC: JSON-per-line credits and/or `[startMs,dur](start,dur,0)word` karaoke."""
	lines = []
	for raw in str(text or "").splitlines():
		row = raw.strip()
		if not row:
			continue
		if row.startswith("{"):
			try:
				obj = json.loads(row)
			except json.JSONDecodeError:
				continue
			begin = float(obj.get("t") or 0) / 1000.0
			words = []
			for chunk in obj.get("c") or []:
				word = str(chunk.get("tx") or chunk.get("c") or "").strip()
				if not word:
					continue
				offset = float(chunk.get("t") or 0) / 1000.0
				words.append({"time": round(begin + offset, 3), "text": word})
			line_text = " ".join(w["text"] for w in words)
			if line_text and not CREDIT_LINE_RE.search(line_text):
				entry = {"time": round(begin, 3), "text": line_text}
				if len(words) >= 2:
					entry["words"] = words
				lines.append(entry)
			continue
		header = re.match(r"^\[(\d+),(\d+)\](.*)$", row)
		if not header:
			continue
		begin = int(header.group(1)) / 1000.0
		line_end = begin + int(header.group(2)) / 1000.0
		words = []
		for match in YRC_WORD_RE.finditer(header.group(3)):
			word = match.group(4).strip()
			if not word:
				continue
			start = int(match.group(1)) / 1000.0
			dur = int(match.group(2)) / 1000.0
			words.append(timed_word(start, word, start + dur))
		line_text = " ".join(w["text"] for w in words)
		if CREDIT_LINE_RE.search(line_text):
			continue
		entry = {"time": round(begin, 3), "end": round(line_end, 3), "text": line_text}
		if len(words) >= 2:
			entry["words"] = words
		if line_text or not words:
			lines.append(entry)
	return lines


def parse_krc(text: str):
	"""Decoded Kugou KRC: `[startMs,durMs]<offsetMs,dur,0>word`."""
	lines = []
	for raw in str(text or "").splitlines():
		if META_LINE_RE.match(raw):
			continue
		match = KRC_LINE_RE.match(raw)
		if not match:
			continue
		begin = int(match.group(1)) / 1000.0
		line_end = begin + int(match.group(2)) / 1000.0
		rest = match.group(3)
		words = []
		for wm in KRC_WORD_RE.finditer(rest):
			word = wm.group(4).strip()
			if not word:
				continue
			start = begin + int(wm.group(1)) / 1000.0
			dur = int(wm.group(2)) / 1000.0
			words.append(timed_word(start, word, start + dur))
		line_text = " ".join(w["text"] for w in words) if words else KRC_WORD_RE.sub("", rest).strip()
		if CREDIT_LINE_RE.search(line_text):
			continue
		entry = {"time": round(begin, 3), "end": round(line_end, 3), "text": line_text}
		if len(words) >= 2:
			entry["words"] = words
		lines.append(entry)
	return lines


def decode_kugou_krc(content: str) -> str:
	raw = base64.b64decode(content)
	if raw[:4] != b"krc1":
		raise ValueError("not a krc1 payload")
	xored = bytes(b ^ KUGOU_KEY[i % len(KUGOU_KEY)] for i, b in enumerate(raw[4:]))
	return zlib.decompress(xored).decode("utf-8")


def is_word_level(lines) -> bool:
	if not lines:
		return False
	return sum(1 for line in lines if len(line.get("words") or []) >= 2) >= 1


def fetch_amll(want):
	title, artist = want["title"], want["artist"]
	query = urllib.parse.urlencode({"musicName": title, "artistName": artist})
	payload = http_json(f"https://api.amll.dev/api/v1/lyrics/search?{query}")
	items = ((payload.get("data") or {}).get("items")) or payload.get("items") or []
	best, best_score = None, 0
	for item in items:
		names = item.get("musicNames") or []
		artists = item.get("artistNames") or []
		got_title = names[0] if names else ""
		got_artist = artists[0] if artists else ""
		score = score_hit(got_artist, got_title, 0, want)
		if score > best_score:
			best, best_score = item, score
	if not best or best_score < 70:
		return empty_result("amll-ttml", "no matching title")
	filename = best.get("filename")
	got = http_json(f"https://api.amll.dev/api/v1/lyrics/get?{urllib.parse.urlencode({'filename': filename})}")
	data = got.get("data") or got
	ttml = data.get("lyrics") or ""
	if not ttml.strip():
		return empty_result("amll-ttml", "empty ttml")
	return {
		**empty_result("amll-ttml"),
		"format": "ttml",
		"wordLevel": True,
		"ttml": ttml,
		"plain": None,
		"artist": (data.get("artistNames") or [artist])[0],
		"title": (data.get("musicNames") or [title])[0],
		"score": best_score,
	}


def fetch_netease(want):
	title, artist = want["title"], want["artist"]
	query = urllib.parse.urlencode({"s": f"{title} {artist}", "type": 1, "limit": 8})
	payload = http_json(
		f"https://music.163.com/api/search/get?{query}",
		headers={"User-Agent": NETEASE_UA, "Referer": "https://music.163.com/"},
	)
	songs = ((payload.get("result") or {}).get("songs")) or []
	best, best_score = None, 0
	for song in songs:
		got_artist = ",".join(a.get("name") or "" for a in (song.get("artists") or []))
		got_title = song.get("name") or ""
		got_dur = (song.get("duration") or 0) / 1000.0
		score = score_hit(got_artist, got_title, got_dur, want)
		if score > best_score:
			best, best_score = song, score
	if not best or best_score < 70:
		return empty_result("netease-yrc", "no matching title")
	lyric = http_json(
		"https://interface3.music.163.com/api/song/lyric/v1",
		data={"id": best["id"], "lv": -1, "kv": -1, "tv": -1, "rv": -1, "yv": -1, "ytv": -1, "yrv": -1},
		headers={"User-Agent": NETEASE_UA, "Referer": "https://music.163.com/"},
	)
	yrc = ((lyric.get("yrc") or {}).get("lyric")) or ""
	lrc = ((lyric.get("lrc") or {}).get("lyric")) or ""
	lines = drop_non_lyric_lines(parse_yrc(yrc), want) if yrc else []
	word_level = is_word_level(lines)
	if not word_level and not lrc:
		return empty_result("netease-yrc", "no lyrics")
	got_artist = ",".join(a.get("name") or "" for a in (best.get("artists") or []))
	return {
		**empty_result("netease-yrc" if word_level else "netease-lrc"),
		"format": "yrc" if word_level else "lrc",
		"wordLevel": word_level,
		"lines": lines if word_level else None,
		"yrc": yrc or None,
		"synced": None if word_level else lrc,
		"plain": lines_to_plain(lines) if word_level else None,
		"artist": got_artist,
		"title": best.get("name"),
		"duration": (best.get("duration") or 0) / 1000.0,
		"score": best_score,
	}


def fetch_kugou(want):
	title, artist = want["title"], want["artist"]
	duration_ms = int(float(want.get("duration") or 0) * 1000)
	payload = http_json(
		"https://lyrics.kugou.com/search?"
		+ urllib.parse.urlencode(
			{
				"ver": 1,
				"man": "yes",
				"client": "pc",
				"keyword": f"{artist} - {title}",
				"duration": duration_ms,
				"hash": "",
				"album_audio_id": "",
			}
		)
	)
	candidates = payload.get("candidates") or []
	best, best_score = None, 0
	for row in candidates:
		score = score_hit(row.get("singer"), row.get("song"), (row.get("duration") or 0) / 1000.0, want)
		if score > best_score:
			best, best_score = row, score
	if not best or best_score < 70:
		return empty_result("kugou-krc", "no matching title")
	downloaded = http_json(
		"https://lyrics.kugou.com/download?"
		+ urllib.parse.urlencode(
			{
				"ver": 1,
				"client": "pc",
				"id": best["id"],
				"accesskey": best["accesskey"],
				"fmt": "krc",
				"charset": "utf8",
			}
		)
	)
	if downloaded.get("status") != 200 or not downloaded.get("content"):
		return empty_result("kugou-krc", "download failed")
	krc = decode_kugou_krc(downloaded["content"])
	lines = drop_non_lyric_lines(parse_krc(krc), want)
	if not is_word_level(lines):
		return empty_result("kugou-krc", "no word timing")
	return {
		**empty_result("kugou-krc"),
		"format": "krc",
		"wordLevel": True,
		"lines": lines,
		"krc": krc,
		"plain": lines_to_plain(lines),
		"artist": best.get("singer"),
		"title": best.get("song"),
		"duration": (best.get("duration") or 0) / 1000.0,
		"score": best_score,
	}


def fetch_syncedlyrics_pkg(want):
	try:
		import syncedlyrics
	except ImportError:
		return empty_result("syncedlyrics", "syncedlyrics not installed")
	query = f"{want['title']} {want['artist']}".strip()
	lrc = None
	try:
		lrc = syncedlyrics.search(query, synced_only=True, enhanced=True)
	except TypeError:
		# Older package builds don't take enhanced=
		try:
			lrc = syncedlyrics.search(query, synced_only=True)
		except Exception as exc:
			return empty_result("syncedlyrics", str(exc))
	except Exception as exc:
		return empty_result("syncedlyrics", str(exc))
	if not lrc:
		return empty_result("syncedlyrics", "no hit")
	# enhanced LRC uses <mm:ss.xx> word tags. Treat that as word-level so
	# Node's parseLRC keeps the real clocks instead of synthesizing.
	word_level = bool(re.search(r"<\d{1,3}:\d{2}(?:\.\d+)?>", lrc))
	return {
		**empty_result("syncedlyrics-enhanced" if word_level else "syncedlyrics"),
		"format": "enhanced-lrc" if word_level else "lrc",
		"wordLevel": word_level,
		"synced": lrc,
		"score": 70,
		"artist": want.get("artist"),
		"title": want.get("title"),
	}


PROVIDERS = (
	("amll-ttml", fetch_amll),
	("netease-yrc", fetch_netease),
	("kugou-krc", fetch_kugou),
	("syncedlyrics", fetch_syncedlyrics_pkg),
)


def search_community(artist, title, album="", duration=0):
	want = {"artist": artist, "title": title, "album": album, "duration": duration}
	if not artist or not title:
		return empty_result(error="usage")
	hits = []
	with ThreadPoolExecutor(max_workers=4) as pool:
		futs = {pool.submit(fn, want): name for name, fn in PROVIDERS}
		for fut in as_completed(futs):
			try:
				hit = fut.result()
			except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError) as exc:
				hit = empty_result(futs[fut], str(exc))
			except Exception as exc:  # provider bugs should not kill the lookup
				hit = empty_result(futs[fut], str(exc))
			if hit and (hit.get("ttml") or hit.get("lines") or hit.get("synced") or hit.get("yrc")):
				hits.append(hit)
	if not hits:
		return empty_result(error="no community hit")
	word_hits = [h for h in hits if h.get("wordLevel") and h.get("score", 0) >= 70]
	ranked = word_hits or [h for h in hits if h.get("score", 0) >= 70] or hits
	FORMAT_RANK = {"ttml": 5, "yrc": 4, "krc": 3, "enhanced-lrc": 3, "lrc": 1}
	ranked.sort(
		key=lambda h: (
			1 if h.get("wordLevel") else 0,
			FORMAT_RANK.get(h.get("format"), 0),
			h.get("score") or 0,
		),
		reverse=True,
	)
	best = ranked[0]
	best["error"] = None
	return best


def main(argv=None):
	argv = list(sys.argv[1:] if argv is None else argv)
	if argv[:1] == ["--self-test"]:
		return self_test()
	if len(argv) < 2:
		print(json.dumps(empty_result(error="usage: community_lyrics.py <artist> <title> [album] [duration]")))
		return 0
	artist, title = argv[0], argv[1]
	album = argv[2] if len(argv) > 2 else ""
	try:
		duration = float(argv[3]) if len(argv) > 3 and argv[3] else 0
	except ValueError:
		duration = 0
	print(json.dumps(search_community(artist, title, album, duration), ensure_ascii=False))
	return 0


def self_test():
	yrc = parse_yrc(
		'[48100,3780](48100,300,0)Caught (48400,60,0)in (48460,210,0)the (48670,630,0)undertow\n'
		'{"t":1000,"c":[{"tx":"Hello","t":0},{"tx":"there","t":400}]}'
	)
	assert yrc[0]["words"][0]["text"] == "Caught"
	assert abs(yrc[0]["words"][1]["time"] - 48.4) < 1e-9
	assert abs(yrc[0]["words"][0]["end"] - 48.4) < 1e-9
	assert yrc[1]["text"] == "Hello there"
	credits = parse_yrc('{"t":0,"c":[{"tx":"作词: "},{"tx":"Mike Shinoda"}]}')
	assert credits == []
	krc = parse_krc("[25872,4298]<0,475,0>Feeling <475,242,0>so <717,1315,0>faithless")
	assert krc[0]["words"][1]["text"] == "so"
	assert abs(krc[0]["words"][1]["time"] - (25.872 + 0.475)) < 1e-9
	assert "end" in krc[0]["words"][1]
	headered = drop_non_lyric_lines(
		parse_krc(
			"[100,100]<0,100,0>Numb (英雄联盟代表音乐) - Linkin Park\n"
			"[25872,4298]<0,475,0>Feeling <475,242,0>so <717,1315,0>faithless"
		),
		{"artist": "Linkin Park", "title": "Numb"},
	)
	assert len(headered) == 1
	assert headered[0]["text"] == "Feeling so faithless"
	credits_end = drop_non_lyric_lines(
		[
			{"time": 10, "text": "a real verse"},
			{"time": 200, "text": "Thanks for listening"},
			{"time": 201, "text": "The end"},
			{"time": 12, "text": "The end is near"},
		]
	)
	assert [row["text"] for row in credits_end] == ["a real verse", "The end is near"]
	assert score_hit("Linkin Park", "Numb", 186, {"artist": "Linkin Park", "title": "Numb", "duration": 186}) >= 90
	assert score_hit("Frank Sinatra", "My Way", 275, {"artist": "Limp Bizkit", "title": "My Way", "duration": 273}) == 0
	print(json.dumps({"ok": True, "tests": 7}))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
