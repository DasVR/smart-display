#!/usr/bin/env bash
# Print a plain-language report of whether the kiosk speakers, Bluetooth,
# and AirPlay receiver are actually wired. Safe to run any time; does not
# change config unless you pass --fix (then it only picks the default sink).
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/das/projects/smart-display}"
FIX=0
BEEP=0
for arg in "$@"; do
	case "$arg" in
		--fix) FIX=1 ;;
		--beep) BEEP=1 ;;
	esac
done

echo "=== smart-display audio doctor ==="
echo "user: $(id -un)  uid=$(id -u)"
echo "groups: $(id -nG)"
if id -nG | grep -qw audio; then
	echo "audio group: yes"
else
	echo "audio group: NO (PipeWire will fall back to Dummy Output until you are added and re-login)"
fi
echo

echo "--- ALSA cards ---"
if [ -r /proc/asound/cards ]; then
	cat /proc/asound/cards
else
	echo "no /proc/asound/cards"
fi
aplay -l 2>&1 || true
echo

echo "--- PipeWire sinks ---"
if command -v wpctl >/dev/null 2>&1; then
	wpctl status || true
	echo
	if [ "$FIX" = "1" ]; then
		PICK_ARGS=()
		[ "$BEEP" = "1" ] && PICK_ARGS+=(--beep)
		node "$PROJECT_DIR/scripts/audio-pick-sink.mjs" "${PICK_ARGS[@]}" || true
	else
		node "$PROJECT_DIR/scripts/audio-pick-sink.mjs" --dry-run || true
	fi
else
	echo "wpctl not installed"
fi
echo

echo "--- Bluetooth adapter ---"
if command -v bluetoothctl >/dev/null 2>&1; then
	bluetoothctl show 2>/dev/null | sed -n '1,20p' || echo "bluetoothctl show failed"
	echo "paired devices:"
	bluetoothctl devices 2>/dev/null || true
else
	echo "bluetoothctl not installed"
fi
echo

echo "--- AirPlay (shairport-sync) ---"
if command -v shairport-sync >/dev/null 2>&1; then
	echo "binary: $(command -v shairport-sync)"
	shairport-sync -V 2>/dev/null || true
else
	echo "shairport-sync not installed"
fi
systemctl --user status smart-display-airplay --no-pager 2>/dev/null || echo "user unit smart-display-airplay: not running"
systemctl --user status smart-display-airplay-meta --no-pager 2>/dev/null || true
systemctl is-active avahi-daemon 2>/dev/null || echo "avahi-daemon: not active"
systemctl is-active nqptp 2>/dev/null || echo "nqptp: not active (needed for AirPlay 2)"
echo

echo "--- services ---"
sudo -n systemctl is-active smart-display-bt-agent 2>/dev/null || systemctl is-active smart-display-bt-agent 2>/dev/null || echo "bt-agent: unknown"
systemctl --user is-active mpris-proxy 2>/dev/null || systemctl --user is-active smart-display-mpris-proxy 2>/dev/null || echo "mpris-proxy: not active"
echo

echo "If speakers say Dummy Output, reboot after joining the audio group."
echo "Apple Music: Control Center or the player AirPlay icon -> Smart Display."
echo "Bluetooth is the fallback; iPhone stereo needs A2DP, not a headset profile."
