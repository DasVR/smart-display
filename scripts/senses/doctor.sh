#!/usr/bin/env bash
# Why doesn't the wall hear me? Run on the display and paste what it prints.
#
#   scripts/senses/doctor.sh          checks, then records 5 s: say "hey display, what time is it?"
#   scripts/senses/doctor.sh --quick  checks only
#
# It reads the wall's state on this machine (nothing is sent anywhere) and
# keeps the recording in /tmp only for as long as it takes to transcribe it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="${WALL_URL:-http://127.0.0.1:3000}"
VENV="${SENSES_VENV:-$HOME/venvs/senses}"
py() { python3 -c "$1" 2>/dev/null; }
say() { printf '\n== %s\n' "$*"; }

say "version"
git -C "$ROOT" log --oneline -1

say "webcam process (smart-display-senses)"
systemctl is-active smart-display-senses || true
systemctl show smart-display-senses -p ActiveEnterTimestamp -p NRestarts | sed 's/^/  /'

say "its last words"
journalctl -u smart-display-senses -n 40 --no-pager -o cat 2>/dev/null | grep -v -E 'Creating a resampler|in_sample_rate|output_sample_rate|^$' | tail -25

say "what the wall's server knows about the microphone"
SENSES="$(curl -s --max-time 5 "$URL/api/senses")"
if [[ -z "$SENSES" ]]; then
	echo "  the wall's server didn't answer on $URL"
else
	printf '%s' "$SENSES" | py '
import json, sys
s = json.load(sys.stdin)
st, mic = s.get("settings", {}), s.get("mic", {})
print("  process online:", s.get("online"))
print("  mic on (setting):", st.get("mic"), "| source:", st.get("micSource") or "(default)")
print("  wake:", st.get("wakeMode"), st.get("wakeWords"), "+ always: hey wall, okay wall, hey display, okay display")
for k in ("ok", "state", "level", "device", "error", "detail", "model"):
    print(f"  mic.{k}:", mic.get(k))
'
fi

say "voice box"
curl -s --max-time 5 "$URL/api/voice/box" | py '
import json, sys
b = json.load(sys.stdin)
print("  up:", b.get("up"), "| ears:", b.get("stt"), "| voice:", b.get("tts"), b.get("model"), "|", len(b.get("voices") or []), "voices")
' || echo "  no answer"

say "microphones PipeWire can see"
pactl list short sources 2>/dev/null | grep -v '\.monitor' | awk '{print "  " $2 "  (" $NF ")"}'
echo "  default: $(pactl get-default-source 2>/dev/null)"

say "installed"
(cd "$ROOT/senses" && "$VENV/bin/python" -m wall_senses --check 2>/dev/null) || echo "  no venv at $VENV (scripts/senses/install.sh)"

[[ "${1:-}" == "--quick" ]] && exit 0

SRC="$(printf '%s' "$SENSES" | py 'import json,sys; print(json.load(sys.stdin).get("settings",{}).get("micSource") or "")')"
WAV="$(mktemp --suffix=.wav)"
trap 'rm -f "$WAV"' EXIT
say "recording 5 s from ${SRC:-the default microphone}: say \"hey display, what time is it?\" now"
timeout 5 parecord ${SRC:+--device="$SRC"} --rate=16000 --channels=1 --format=s16le --file-format=wav "$WAV" 2>/dev/null
py "
import wave, struct, math
w = wave.open('$WAV'); n = w.getnframes(); d = w.readframes(n)
v = struct.unpack('<%dh' % (len(d) // 2), d) if d else ()
peak = max((abs(x) for x in v), default=0) / 32768
rms = math.sqrt(sum(x * x for x in v) / max(1, len(v))) / 32768
print(f'  {n / 16000:.1f} s recorded, loudest {peak:.3f}, average {rms:.4f}', '(silent: wrong microphone, or muted)' if peak < 0.02 else '(quiet: your voice is barely above the room; speak closer, or raise the input volume)' if peak < 6 * rms else '')
" || echo "  nothing recorded (is parecord installed? pulseaudio-utils)"
say "what Parakeet heard"
curl -s --max-time 60 -F "file=@$WAV" -F response_format=text "$URL/v1/audio/transcriptions"
echo
