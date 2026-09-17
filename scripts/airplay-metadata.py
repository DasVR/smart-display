#!/usr/bin/env python3
"""Read the shairport-sync metadata pipe and keep a now-playing JSON file
the dashboard can merge into /api/nowplaying when Apple Music is AirPlaying.
"""
import base64
import json
import os
import re
import select
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

FRAMES = 44100
RTP_MOD = 2**32

state = {
	"playing": False,
	"paused": False,
	"title": "",
	"artist": "",
	"album": "",
	"art": "",
	"position": 0,
	"positionAt": 0,
	"length": 0,
	"source": "airplay",
	"updatedAt": 0,
	# Set on a flush (skip/seek) and cleared by the next progress report.
	# There's no seek-target payload in this protocol - only a fresh `prgr`
	# actually tells us where playback landed - so this just tells clients
	# "don't trust position/positionAt for extrapolation right now" instead
	# of quietly drifting further from reality on every heartbeat.
	"seeking": False,
}


def decode_tag(raw):
	text = raw.decode("ascii", errors="replace").strip()
	if re.fullmatch(r"[0-9a-fA-F]{8}", text):
		try:
			return bytes.fromhex(text).decode("ascii", errors="replace")
		except Exception:
			return text
	return text


def stamp_position():
	# Sample time for the position field. Heartbeats must not call this.
	state["positionAt"] = int(time.time() * 1000)


def freeze_position():
	# Bake extrapolated progress into `position` so a pause does not rewind
	# karaoke to the last `prgr` sample. Only while playing - a second pause
	# must not add wall time on top of the already-frozen clock.
	at = int(state.get("positionAt") or 0)
	if state.get("playing") and at:
		elapsed = max(0.0, (time.time() * 1000 - at) / 1000.0)
		length = float(state.get("length") or 0)
		pos = float(state.get("position") or 0) + elapsed
		if length > 0:
			pos = min(pos, length)
		state["position"] = pos
	stamp_position()


def resume_clock():
	# Start extrapolating from the frozen position. If we are already
	# playing, do not restamp - that is what sent lyrics back to the last
	# `prgr` on a stray caps=2 / prsm, then jumped them forward on the next
	# real progress report.
	if not state.get("playing"):
		stamp_position()
	state["playing"] = True
	state["paused"] = False


def clear_session():
	# Session end (pend) must wipe metadata. Leaving a title behind made
	# the dashboard treat a disconnected receiver as a paused track, and
	# the idle keepalive then restamped updatedAt forever.
	state["playing"] = False
	state["paused"] = False
	state["title"] = ""
	state["artist"] = ""
	state["album"] = ""
	state["art"] = ""
	state["position"] = 0
	state["positionAt"] = 0
	state["length"] = 0
	state["seeking"] = False


def write_state():
	state["updatedAt"] = int(time.time() * 1000)
	directory = os.path.dirname(STATE_PATH)
	if directory:
		os.makedirs(directory, exist_ok=True)
	tmp = STATE_PATH + ".tmp"
	with open(tmp, "w", encoding="utf-8") as handle:
		json.dump(state, handle)
	os.replace(tmp, STATE_PATH)


def rtp_delta(start, end):
	return (int(end) - int(start)) % RTP_MOD


def parse_int(data):
	if not data:
		return None
	text = data.decode("utf-8", errors="ignore").strip()
	if text.isdigit():
		return int(text)
	if len(data) in (1, 2, 4, 8):
		return int.from_bytes(data, "big", signed=False)
	return None


def apply_progress(data):
	text = data.decode("utf-8", errors="replace").strip()
	parts = text.split("/")
	if len(parts) != 3:
		return False
	try:
		start, current, end = (int(part) for part in parts)
	except ValueError:
		return False
	length = rtp_delta(start, end) / FRAMES
	position = rtp_delta(start, current) / FRAMES
	if length <= 0:
		return False
	state["length"] = length
	state["position"] = min(position, length)
	state["seeking"] = False
	stamp_position()
	return True


def apply_item(typ, code, data):
	changed = False
	if typ not in ("ssnc", "core"):
		return False
	if code == "pbeg":
		resume_clock()
		changed = True
	elif code == "pend":
		clear_session()
		changed = True
	elif code == "pfls":
		# Flush fires on skip/seek. Audio is still the AirPlay session, but
		# the position we're holding is now stale until the next prgr lands.
		state["seeking"] = True
		changed = True
	elif code == "prsm":
		resume_clock()
		changed = True
	elif code == "prgr":
		changed = apply_progress(data)
	elif code in ("phbt", "phb0"):
		# Heartbeats are the liveness signal for both playing and paused.
		# A paused session that stops getting them is a disconnect.
		changed = state["playing"] or state["paused"]
	elif code == "caps":
		status = parse_int(data)
		if status == 3:
			freeze_position()
			state["playing"] = False
			state["paused"] = True
			changed = True
		elif status == 2:
			resume_clock()
			changed = True
	elif code == "minm":
		title = data.decode("utf-8", errors="replace")
		if title != state["title"]:
			state["position"] = 0
			state["seeking"] = False
			stamp_position()
		state["title"] = title
		state["playing"] = True
		state["paused"] = False
		changed = True
	elif code == "asar":
		state["artist"] = data.decode("utf-8", errors="replace")
		changed = True
	elif code == "asal":
		state["album"] = data.decode("utf-8", errors="replace")
		changed = True
	elif code == "astm":
		millis = parse_int(data)
		if millis and millis > 0:
			state["length"] = millis / 1000.0
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
				ready, _, _ = select.select([pipe], [], [], 1.0)
				if not ready:
					# Do not keepalive from title leftovers or a paused clock.
					# Progress and heartbeats refresh updatedAt; rewriting the
					# file here hid AirPlay disconnects (especially while paused).
					continue
				chunk = os.read(pipe.fileno(), 4096)
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
