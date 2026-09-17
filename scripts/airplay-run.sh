#!/usr/bin/env bash
set -euo pipefail
CONF="${HOME}/.config/shairport-sync.conf"
BIN=""
for cand in /usr/local/bin/shairport-sync /usr/bin/shairport-sync; do
	if [ -x "$cand" ]; then
		BIN="$cand"
		break
	fi
done
if [ -z "$BIN" ]; then
	BIN="$(command -v shairport-sync || true)"
fi
if [ -z "$BIN" ]; then
	echo "shairport-sync is not installed" >&2
	exit 1
fi
# Phone AirPlay volume used to attenuate this stream (`ignore_volume_control
# = "no"`). A session that connects at 0 plays metadata with no sound.
# Prefer the kiosk speaker level; setup writes "yes", and this patch covers
# a box that has not re-run airplay-setup yet.
if [ -f "$CONF" ]; then
	sed -i 's/ignore_volume_control = "no"/ignore_volume_control = "yes"/' "$CONF" || true
fi
exec "$BIN" -c "$CONF"
