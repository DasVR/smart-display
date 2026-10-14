#!/usr/bin/env bash
# A cleaner webcam microphone, made by PipeWire itself (optional).
#
#   scripts/senses/clean-mic.sh           add "Wall mic (cleaned)"
#   scripts/senses/clean-mic.sh --undo    take it away again
#
# PipeWire's echo-cancel module with WebRTC's audio processing (the same
# processing video calls use): noise suppression, automatic gain, a
# high-pass filter, and echo cancellation, which takes whatever the speakers
# are playing (the wall's voice, music) back out of the microphone. That is
# what lets "hey wall" be heard over music.
#
# It adds a new input, wall_mic, fed by the webcam's microphone; the senses
# service listens to it by itself when it exists. Nothing else changes: the
# speakers and other apps are left alone. Run it as the wall's user (das).
# PipeWire restarts, so music playing at the moment stops for a second.
set -euo pipefail

CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pipewire/pipewire.conf.d"
CONF="$CONF_DIR/60-wall-mic.conf"

restart_pipewire() {
	systemctl --user restart pipewire pipewire-pulse 2>/dev/null || systemctl --user restart pipewire
	systemctl --user restart wireplumber 2>/dev/null || true
	sleep 2
}

if [[ "${1:-}" == "--undo" ]]; then
	rm -f "$CONF"
	restart_pipewire
	echo "removed. The senses service goes back to the webcam's own microphone."
	exit 0
fi

if [[ "$(id -u)" == 0 ]]; then
	echo "run this as the wall's user (das), not root" >&2
	exit 1
fi
command -v pactl >/dev/null || { echo "pactl is missing (pulseaudio-utils)" >&2; exit 1; }

# the webcam's microphone: a capture source that looks like a webcam, never a monitor
SOURCE="${WALL_MIC_SOURCE:-$(pactl list short sources | awk '{print $2}' | grep -v '\.monitor$' | grep -v '^wall_mic' | grep -Ei 'usb|cam|webcam|brio|c9[0-9][0-9]|c270|c310|logi|razer|kiyo|elgato|emeet|anker' | head -1)}"
if [[ -z "$SOURCE" ]]; then
	echo "couldn't find a webcam microphone. Sources:" >&2
	pactl list short sources | awk '{print "  " $2}' >&2
	echo "pick one and run: WALL_MIC_SOURCE=<name> $0" >&2
	exit 1
fi
echo "webcam microphone: $SOURCE"

# echo cancellation against the speakers needs PipeWire's monitor mode (1.0 and later)
VER="$(pipewire --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tail -1 || true)"
MAJOR="${VER%%.*}"
MONITOR="monitor.mode = true"
if [[ -z "$MAJOR" || "$MAJOR" -lt 1 ]]; then
	MONITOR="# monitor.mode needs PipeWire 1.0 (found ${VER:-unknown}): no echo cancellation of the speakers"
	echo "note: PipeWire ${VER:-unknown}: noise suppression yes, cancelling the speakers no (needs 1.0)"
fi

mkdir -p "$CONF_DIR"
cat >"$CONF" <<EOF
# Written by smart-display scripts/senses/clean-mic.sh; remove with --undo.
# The webcam's microphone, cleaned by WebRTC: noise suppression, gain control,
# high-pass, and echo cancellation of what the speakers play.
context.modules = [
    {   name = libpipewire-module-echo-cancel
        # a failure here must never take PipeWire (and the wall's sound) down with it
        flags = [ nofail ]
        args = {
            library.name = aec/libspa-aec-webrtc
            $MONITOR
            aec.args = {
                webrtc.high_pass_filter = true
                webrtc.noise_suppression = true
                webrtc.gain_control = true
                webrtc.extended_filter = true
                webrtc.delay_agnostic = true
            }
            capture.props = {
                node.name = "wall_mic.capture"
                node.passive = true
                target.object = "$SOURCE"
            }
            source.props = {
                node.name = "wall_mic"
                node.description = "Wall mic (cleaned)"
            }
            sink.props = {
                node.name = "wall_mic.reference"
                node.description = "Wall mic echo reference"
            }
            playback.props = {
                node.name = "wall_mic.playback"
            }
        }
    }
]
EOF
echo "wrote $CONF"
restart_pipewire

if pactl list short sources | awk '{print $2}' | grep -qx wall_mic; then
	echo "ok: \"Wall mic (cleaned)\" is there."
	if systemctl is-enabled --quiet smart-display-senses 2>/dev/null; then
		sudo systemctl restart smart-display-senses && echo "the senses service now listens to it."
	fi
	echo "Its own noise suppression overlaps the wall's: on the phone, Senses → Noise suppression can go to Off or Light."
else
	echo "PipeWire didn't make the cleaned input (its WebRTC module may be missing on this system)." >&2
	echo "Nothing else changed; undo with: $0 --undo" >&2
	exit 1
fi
