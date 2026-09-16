#!/usr/bin/env python3
"""CLI wrapper around the `syncedlyrics` package for lyrics.js's second
lookup tier (after lrclib.net comes up empty). syncedlyrics aggregates
several providers (NetEase, Musixmatch, etc.), so it catches some tracks
LRCLIB's own crowd-sourced database doesn't have.

Install: pip install syncedlyrics

Usage:
	python3 syncedlyrics_lookup.py <artist> <title>

Prints {"synced": "<lrc text>" | null} as JSON to stdout. Any failure
(package missing, no match, provider error) prints {"synced": null} rather
than raising, since this is a best-effort fallback the caller should
silently move past.
"""
import json
import sys


def main():
	if len(sys.argv) < 3:
		print(json.dumps({"synced": None, "error": "usage: syncedlyrics_lookup.py <artist> <title>"}))
		return 0
	artist, title = sys.argv[1], sys.argv[2]
	try:
		import syncedlyrics
	except ImportError:
		print(json.dumps({"synced": None, "error": "syncedlyrics not installed"}))
		return 0
	try:
		lrc = syncedlyrics.search(f"{title} {artist}", synced_only=True)
	except Exception as exc:
		print(json.dumps({"synced": None, "error": str(exc)}))
		return 0
	print(json.dumps({"synced": lrc}))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
