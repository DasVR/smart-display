#!/usr/bin/env python3
"""Canonical lyric *text* for the singing aligner.

Karaoke files (AMLL / YRC / KRC / Musixmatch) carry clocks, but the words
are often clipped, lowercased, or a different transcription than the
published lyric sheet. Alignment should time one consistent sheet against
the audio.

Order (first scored hit wins):
  1. Genius  - optional unsynced editorial sheet. Needs GENIUS_ACCESS_TOKEN
               and lyricsgenius. Scrape-backed; breaks without warning;
               returns [Chorus]/[Verse] tags and no timestamps. Not used
               for karaoke clocks. Timed sheets come from syncedlyrics.
  2. LRCLIB  - keyless equivalent. `plainLyrics` from lrclib.net, scored
               the same way the rest of this pipeline scores a title/artist
               match so a popular wrong "My Way" never lands.

Prints one JSON object to stdout. Failures are a null `plain`, never a
nonzero exit, so the Node caller can still use community karaoke text.

Usage:
	python3 canonical_lyrics.py <artist> <title> [album] [duration]
	python3 canonical_lyrics.py --self-test
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
	sys.path.insert(0, HERE)

from community_lyrics import UA, empty_result, http_json, score_hit  # noqa: E402

# Case-sensitive: the page header is "<Title> Lyrics"; a sung first line
# ending in lowercase "lyrics" stays.
GENIUS_HEADER_RE = re.compile(r"^.+?\sLyrics\s*\n")
GENIUS_CONTRIB_RE = re.compile(r"^\d+\s+Contributors.*?\n", re.I)
# Any bracketed heading on its own line: [Verse 2: Artist], [Post-Chorus],
# [Skit], [Produced by ...]. Genius never puts sung words in square brackets.
GENIUS_SECTION_RE = re.compile(r"^\s*\[[^\]\n]*\]\s*$", re.M)
EMBED_RE = re.compile(r"\d*\s*Embed\s*$", re.I)
# lyricsgenius scrapes page chrome into the text.
GENIUS_JUNK_RE = re.compile(
	r"^\s*(you might also like|get tickets as low as \$\d+|\d+\s+contributors?\b.*|translations?)\s*$",
	re.I,
)


def clean_genius_lyrics(text: str) -> str:
	"""Strip Genius page chrome so the aligner sees sung lines only."""
	raw = str(text or "").replace("\r\n", "\n")
	raw = GENIUS_CONTRIB_RE.sub("", raw, count=1)
	raw = GENIUS_HEADER_RE.sub("", raw, count=1)
	raw = GENIUS_SECTION_RE.sub("", raw)
	raw = EMBED_RE.sub("", raw)
	# "You might also like" also lands glued to the end of a sung line.
	raw = re.sub(r"You might also like", "\n", raw)
	raw = re.sub(r"See [^\n]+ LiveGet tickets as low as \$\d+", "\n", raw)
	raw = "\n".join(line for line in raw.split("\n") if not GENIUS_JUNK_RE.match(line))
	raw = re.sub(r"\n\s*\n(\s*\n)+", "\n\n", raw)
	raw = re.sub(r"\n{3,}", "\n\n", raw)
	return raw.strip()


def fetch_genius(want) -> dict | None:
	token = (os.environ.get("GENIUS_ACCESS_TOKEN") or "").strip()
	if not token:
		return None
	try:
		import lyricsgenius
	except ImportError:
		return None
	try:
		genius = lyricsgenius.Genius(
			token,
			verbose=False,
			remove_section_headers=True,
			skip_non_songs=True,
			timeout=8,
			retries=0,
		)
		song = genius.search_song(want.get("title") or "", want.get("artist") or "")
	except Exception:
		return None
	if not song or not getattr(song, "lyrics", None):
		return None
	plain = clean_genius_lyrics(song.lyrics)
	if not plain:
		return None
	got_title = getattr(song, "title", "") or want.get("title")
	primary = getattr(song, "primary_artist", None)
	got_artist = getattr(primary, "name", None) or getattr(song, "artist", "") or want.get("artist")
	if score_hit(got_artist, got_title, 0, want) < 70:
		return None
	return {
		"plain": plain,
		"source": "genius",
		"artist": got_artist,
		"title": got_title,
	}


def fetch_lrclib_plain(want) -> dict | None:
	params = {
		"artist_name": want.get("artist") or "",
		"track_name": want.get("title") or "",
	}
	if want.get("album"):
		params["album_name"] = want["album"]
	if want.get("duration"):
		params["duration"] = str(int(float(want["duration"])))
	url = "https://lrclib.net/api/get?" + urllib.parse.urlencode(params)
	hit = None
	try:
		hit = http_json(url, timeout=6)
		if score_hit(hit.get("artistName"), hit.get("trackName"), hit.get("duration"), want) < 70:
			hit = None
	except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, TypeError, ValueError):
		hit = None
	if not hit:
		search = urllib.parse.urlencode(
			{"artist_name": want.get("artist") or "", "track_name": want.get("title") or ""}
		)
		try:
			found = http_json("https://lrclib.net/api/search?" + search, timeout=6)
		except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
			found = []
		best = None
		best_score = 0
		for row in found or []:
			score = score_hit(row.get("artistName"), row.get("trackName"), row.get("duration"), want)
			if score > best_score:
				best = row
				best_score = score
		if best_score >= 70:
			hit = best
	if not hit:
		return None
	plain = str(hit.get("plainLyrics") or "").strip()
	if not plain:
		synced = str(hit.get("syncedLyrics") or "")
		plain = "\n".join(re.sub(r"\[\d+:\d+(?:\.\d+)?\]\s*", "", line).strip() for line in synced.splitlines())
		plain = "\n".join(line for line in plain.splitlines() if line)
	if not plain:
		return None
	return {
		"plain": plain,
		"source": "lrclib-plain",
		"artist": hit.get("artistName") or want.get("artist"),
		"title": hit.get("trackName") or want.get("title"),
	}


def lookup(want) -> dict:
	for fetcher in (fetch_genius, fetch_lrclib_plain):
		try:
			hit = fetcher(want)
		except Exception:
			hit = None
		if hit and hit.get("plain"):
			return hit
	return {"plain": None, "source": None, "artist": want.get("artist"), "title": want.get("title")}


def self_test() -> int:
	cleaned = clean_genius_lyrics(
		"12 Contributors\nSample Track Lyrics\n[Verse 1]\nI walk a lonely road\n[Chorus]\nThe only one that I have ever known\n99Embed"
	)
	assert "Contributors" not in cleaned
	assert "Lyrics" not in cleaned.split("\n")[0]
	assert "I walk a lonely road" in cleaned
	assert "The only one that I have ever known" in cleaned
	assert "[" not in cleaned
	assert "Embed" not in cleaned
	junk = clean_genius_lyrics(
		"[Intro: Somebody]\nFirst line\nYou might also like\n[Post-Chorus]\nSecond lineYou might also like\n[Skit]\nThird line12Embed"
	)
	assert [line for line in junk.split("\n") if line] == ["First line", "Second line", "Third line"], junk
	assert "\n\n\n" not in junk
	kept = clean_genius_lyrics("I keep writing these lyrics\nSee how we live")
	assert kept == "I keep writing these lyrics\nSee how we live", kept
	empty = lookup({"artist": "", "title": ""})
	assert empty["plain"] is None
	print(json.dumps({"ok": True, "tests": 3}))
	return 0


def main(argv=None) -> int:
	args = list(sys.argv[1:] if argv is None else argv)
	if args[:1] == ["--self-test"]:
		return self_test()
	if len(args) < 2:
		print(json.dumps(empty_result(error="usage: canonical_lyrics.py <artist> <title> [album] [duration]")))
		return 0
	want = {
		"artist": args[0],
		"title": args[1],
		"album": args[2] if len(args) > 2 else "",
		"duration": args[3] if len(args) > 3 else 0,
	}
	print(json.dumps(lookup(want)))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
