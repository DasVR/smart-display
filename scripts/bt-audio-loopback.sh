#!/usr/bin/env bash
# Route a phone's incoming A2DP stream onto the default PipeWire sink.
# iOS connects as a capture source (bluez_input.*); without a loopback the
# track is "playing" on the phone and silent on the speakers.
set -euo pipefail

ACTION="${1:-start}"

have_pactl() {
	command -v pactl >/dev/null 2>&1
}

unload_loopbacks() {
	have_pactl || return 0
	pactl list short modules 2>/dev/null | awk '
		$2 == "module-loopback" && /bluez/ { print $1 }
	' | while read -r id; do
		[ -n "$id" ] || continue
		pactl unload-module "$id" >/dev/null 2>&1 || true
	done
}

if [ "$ACTION" = "stop" ]; then
	unload_loopbacks
	exit 0
fi

if ! have_pactl; then
	echo "bt-audio-loopback: pactl not found; install pulseaudio-utils" >&2
	exit 1
fi

source_name=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
	source_name="$(pactl list short sources 2>/dev/null | awk '/bluez/ { print $2; exit }' || true)"
	if [ -n "$source_name" ]; then
		break
	fi
	sleep 1
done

if [ -z "$source_name" ]; then
	echo "bt-audio-loopback: no bluez source appeared" >&2
	exit 1
fi

unload_loopbacks
pactl load-module module-loopback source="$source_name" sink=@DEFAULT_SINK@ latency_msec=50 >/dev/null
echo "bt-audio-loopback: $source_name -> @DEFAULT_SINK@"
