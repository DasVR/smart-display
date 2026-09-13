#!/usr/bin/env bash
# Notify the dashboard that AirPlay playback is starting (Music view + island).
# Must return immediately: iOS drops the AirPlay 2 handshake if this blocks.
set -u
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
curl -sS -m 2 -X POST "${DASHBOARD_URL}/api/airplay/connected" \
	-H 'Content-Type: application/json' \
	-d '{"name":"Apple Music"}' >/dev/null 2>&1 &
exit 0
