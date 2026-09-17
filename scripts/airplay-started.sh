#!/usr/bin/env bash
# Notify the dashboard that AirPlay playback is starting (Music view + island).
# Must return immediately: iOS drops the AirPlay 2 handshake if this blocks.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
curl -sS -m 2 -X POST "${DASHBOARD_URL}/api/airplay/connected" \
	-H 'Content-Type: application/json' \
	-d '{"name":"Apple Music"}' >/dev/null 2>&1 &
# Metadata can look "connected" while PipeWire is still on Dummy/HDMI or muted.
# Pick the analog/USB/headphone sink and unmute in the background so the
# handshake is not delayed.
(
	node "$ROOT/scripts/audio-pick-sink.mjs" >/dev/null 2>&1 || true
	wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 >/dev/null 2>&1 || true
) &
exit 0
