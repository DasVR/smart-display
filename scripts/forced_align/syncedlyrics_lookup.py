#!/usr/bin/env python3
"""CLI for lyrics.js community lookup.

Tries AMLL TTML, NetEase YRC, Kugou KRC, then the syncedlyrics package
(Musixmatch enhanced / line LRC). Prints one JSON object to stdout.

Usage:
	python3 syncedlyrics_lookup.py <artist> <title> [album] [duration]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
	sys.path.insert(0, HERE)

from community_lyrics import empty_result, main as community_main  # noqa: E402


def main():
	if len(sys.argv) < 3:
		print(json.dumps(empty_result(error="usage: syncedlyrics_lookup.py <artist> <title> [album] [duration]")))
		return 0
	return community_main(sys.argv[1:])


if __name__ == "__main__":
	raise SystemExit(main())
