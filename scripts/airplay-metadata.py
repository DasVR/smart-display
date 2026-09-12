#!/usr/bin/env python3
"""Read the shairport-sync metadata pipe and keep a now-playing JSON file
the dashboard can merge into /api/nowplaying when Apple Music is AirPlaying.
"""
import base64
import json
import os
import re
import sys
import time

STATE_PATH = os.environ.get(
	"AIRPLAY_NOWPLAYING_PATH",
	os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000"), "smart-display-airplay.json"),
)
ART_PATH = os.environ.get(
	"AIRPLAY_ART_PATH",
	os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000"), "smart-display-airplay-art.jpg"),
)
PIPE = os.environ.get(
	"AIRPLAY_METADATA_PIPE",
	os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000"), "shairport-sync-metadata"),
)
ART_URL = os.environ.get("AIRPLAY_ART_URL", "/api/nowplaying/art")

ITEM_RE = re.compile(
	rb"<item>\s*<type>([^<]+)</type>\s*<code>([^<]+)</code>\s*<length>(\d+)</length>"
	rb"(?:\s*<data encoding=\"base64\">([^<]*)</data>)?\s*</item>",
	re.I | re.S,
)

state = {
	"playing": False,
	"title": "",
	"artist": "",
	"album": "",
	"art": "",
	"position": 0,
	"length": 0,
	"source": "airplay",
	"updatedAt": 0,
}


def decode_tag(raw):
	text = raw.decode("ascii", errors="replace").strip()
	if re.fullmatch(r"[0-9a-fA-F]{8}", text):
		try:
			return bytes.fromhex(text).decode("ascii", errors="replace")
		except Exception:
			return text
	return text


def write_state():
	state["updatedAt"] = int(time.time() * 1000)
	directory = os.path.dirname(STATE_PATH)
	if directory:
		os.makedirs(directory, exist_ok=True)
	tmp = STATE_PATH + ".tmp"
	with open(tmp, "w", encoding="utf-8") as handle:
		json.dump(state, handle)
	os.replace(tmp, STATE_PATH)


def apply_item(typ, code, data):
	changed = False
	if typ in ("ssnc", "core"):
		if code == "pbeg":
			state["playing"] = True
			changed = True
		elif code in ("pend", "pfls"):
			state["playing"] = False
			changed = True
		elif code == "prsm":
			state["playing"] = True
			changed = True
		elif code == "minm":
			state["title"] = data.decode("utf-8", errors="replace")
			state["playing"] = True
			changed = True
		elif code == "asar":
			state["artist"] = data.decode("utf-8", errors="replace")
			changed = True
		elif code == "asal":
			state["album"] = data.decode("utf-8", errors="replace")
			changed = True
		elif code == "PICT" and data:
			art_dir = os.path.dirname(ART_PATH)
			if art_dir:
				os.makedirs(art_dir, exist_ok=True)
			with open(ART_PATH, "wb") as handle:
				handle.write(data)
			state["art"] = f"{ART_URL}?t={int(time.time())}"
			changed = True
	return changed


def consume(buf):
	progress = False
	while True:
		match = ITEM_RE.search(buf)
		if not match:
			break
		typ = decode_tag(match.group(1))
		code = decode_tag(match.group(2))
		payload = b""
		if match.group(4):
			try:
				payload = base64.b64decode(match.group(4))
			except Exception:
				payload = b""
		if apply_item(typ, code, payload):
			write_state()
		buf = buf[match.end() :]
		progress = True
	if len(buf) > 1_000_000:
		buf = buf[-64_000:]
	return buf, progress


def open_pipe():
	directory = os.path.dirname(PIPE)
	if directory:
		os.makedirs(directory, exist_ok=True)
	if not os.path.exists(PIPE):
		os.mkfifo(PIPE, 0o600)
	print(f"reading shairport metadata from {PIPE}", flush=True)
	return open(PIPE, "rb", buffering=0)


def main():
	write_state()
	buf = b""
	while True:
		try:
			pipe = open_pipe()
		except Exception as exc:
			print(f"metadata pipe open failed: {exc}", file=sys.stderr, flush=True)
			time.sleep(2)
			continue
		try:
			while True:
				chunk = pipe.read(4096)
				if not chunk:
					break
				buf += chunk
				buf, _ = consume(buf)
		except Exception as exc:
			print(f"metadata read failed: {exc}", file=sys.stderr, flush=True)
		finally:
			try:
				pipe.close()
			except Exception:
				pass
		time.sleep(0.5)


if __name__ == "__main__":
	if len(sys.argv) > 1 and sys.argv[1] == "--parse-stdin":
		buf = sys.stdin.buffer.read()
		consume(buf)
		print(json.dumps(state))
		raise SystemExit(0)
	main()
