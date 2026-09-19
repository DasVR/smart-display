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
import urllib.request

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
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000")
HEARTBEAT_STALE_S = 8.0

ITEM_RE = re.compile(
	rb"<item>\s*<type>([^<]+)</type>\s*<code>([^<]+)</code>\s*<length>(\d+)</length>"
	rb"(?:\s*<data encoding=\"base64\">([^<]*)</data>)?\s*</item>",
	re.I | re.S,
)

FRAMES = 44100
FRAMES_48000 = 48000
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
	# Last AirPlay `prgr` RTP triple. Kept so a later `astm` duration can
	# rescale a 48kHz clock; dividing those timestamps by 44100 made a
	# mid-song scrub land about 10 seconds fast.
	"_rtp": None,
	"_astm_length": 0.0,
	"sampleRate": FRAMES,
}

last_live = time.time()


def touch_live():
	global last_live
	last_live = time.time()


def notify_disconnected(name="Apple Music"):
	payload = json.dumps({"name": name}).encode("utf-8")
	try:
		req = urllib.request.Request(
			f"{DASHBOARD_URL}/api/airplay/disconnected",
			method="POST",
			data=payload,
			headers={"Content-Type": "application/json"},
		)
		urllib.request.urlopen(req, timeout=2)
		print("notified dashboard: airplay disconnected", flush=True)
	except Exception as exc:
		print(f"failed to notify dashboard: {exc}", file=sys.stderr, flush=True)


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


def pause_clock():
	# Phone pause must keep title/art/position on screen. iOS often sends
	# `pend` (stream end) instead of, or in addition to, caps=3; wiping the
	# session made pause look like "Nothing playing".
	freeze_position()
	state["playing"] = False
	state["paused"] = True
	state["seeking"] = False


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
	# Real teardown with no track left to show. A titled `pend` uses
	# pause_clock instead; disconnect then drops once heartbeats stop.
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
	state["_rtp"] = None
	state["_astm_length"] = 0.0
	state["sampleRate"] = FRAMES


def write_state():
	state["updatedAt"] = int(time.time() * 1000)
	directory = os.path.dirname(STATE_PATH)
	if directory:
		os.makedirs(directory, exist_ok=True)
	public = {key: value for key, value in state.items() if not str(key).startswith("_")}
	tmp = STATE_PATH + ".tmp"
	with open(tmp, "w", encoding="utf-8") as handle:
		json.dump(public, handle)
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


def infer_sample_rate(rtp_len, duration):
	if duration > 1 and rtp_len > 0:
		rate = rtp_len / duration
		if abs(rate - FRAMES_48000) < abs(rate - FRAMES):
			return FRAMES_48000
		return FRAMES
	return int(state.get("sampleRate") or FRAMES)


def apply_clock(stamp=False):
	rtp = state.get("_rtp")
	if not rtp:
		return False
	start, current, end = rtp
	rtp_len = rtp_delta(start, end)
	rtp_pos = rtp_delta(start, current)
	if rtp_len <= 0:
		return False
	duration = float(state.get("_astm_length") or 0)
	rate = infer_sample_rate(rtp_len, duration)
	state["sampleRate"] = rate
	if duration > 1:
		length = duration
		position = rtp_pos * duration / rtp_len
	else:
		length = rtp_len / rate
		position = rtp_pos / rate
	state["length"] = length
	state["position"] = min(position, length) if length else position
	if stamp:
		state["seeking"] = False
		stamp_position()
	return True


def apply_progress(data):
	text = data.decode("utf-8", errors="replace").strip()
	parts = text.split("/")
	if len(parts) != 3:
		return False
	try:
		start, current, end = (int(part) for part in parts)
	except ValueError:
		return False
	state["_rtp"] = (start, current, end)
	return apply_clock(stamp=True)


def apply_item(typ, code, data):
	changed = False
	if typ not in ("ssnc", "core"):
		return False
	if code == "pbeg":
		resume_clock()
		touch_live()
		changed = True
	elif code == "pend":
		# Pause and disconnect both look like stream end. Keep a titled
		# session paused; an empty stream (pbeg with no tags, then pend)
		# still tears down. Stale timeout handles a phone that left.
		if state.get("title") or state.get("artist"):
			pause_clock()
			touch_live()
		else:
			clear_session()
		changed = True
	elif code == "pfls":
		# Flush fires on skip/seek. Audio is still the AirPlay session, but
		# the position we're holding is now stale until the next prgr lands.
		# Bake the extrapolated clock first so karaoke does not rewind to
		# the last prgr, then freeze until that landing (or the client
		# expires a stuck seeking flag).
		freeze_position()
		state["seeking"] = True
		touch_live()
		changed = True
	elif code == "prsm":
		resume_clock()
		touch_live()
		changed = True
	elif code == "prgr":
		changed = apply_progress(data)
		if changed:
			touch_live()
	elif code in ("phbt", "phb0"):
		# Heartbeats are the liveness signal for both playing and paused.
		# A paused session that stops getting them is a disconnect.
		changed = state["playing"] or state["paused"]
		if changed:
			touch_live()
	elif code == "caps":
		status = parse_int(data)
		if status == 3:
			pause_clock()
			touch_live()
			changed = True
		elif status == 2:
			resume_clock()
			touch_live()
			changed = True
	elif code == "minm":
		title = data.decode("utf-8", errors="replace")
		if title != state["title"]:
			state["position"] = 0
			state["_rtp"] = None
			state["_astm_length"] = 0.0
			# Until the next `prgr` lands, treat a title change like a
			# flush so the client will accept a start-of-track clock.
			state["seeking"] = True
			stamp_position()
		state["title"] = title
		# A metadata restamp must not unpause. Resume is pbeg / prsm / caps=2.
		if not state.get("paused"):
			state["playing"] = True
			state["paused"] = False
		touch_live()
		changed = True
	elif code == "asar":
		state["artist"] = data.decode("utf-8", errors="replace")
		changed = True
	elif code == "asal":
		state["album"] = data.decode("utf-8", errors="replace")
		changed = True
	elif code == "ofps":
		# Output rate from shairport-sync, usually "44100" or "48000".
		rate = parse_int(data)
		if not rate and data:
			try:
				rate = int(float(data.decode("utf-8", errors="ignore").strip()))
			except ValueError:
				rate = 0
		if rate in (FRAMES, FRAMES_48000) and rate != state.get("sampleRate"):
			state["sampleRate"] = rate
			apply_clock(stamp=False)
			changed = True
	elif code == "astm":
		millis = parse_int(data)
		if millis and millis > 0:
			state["_astm_length"] = millis / 1000.0
			if not apply_clock(stamp=False):
				state["length"] = state["_astm_length"]
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
					# Heartbeats keep a paused session alive. Once they stop,
					# this is a phone that left, not a pause we should hold
					# for five minutes.
					if (state.get("playing") or state.get("paused")) and (
						time.time() - last_live > HEARTBEAT_STALE_S
					):
						clear_session()
						write_state()
						notify_disconnected()
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
