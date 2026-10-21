#!/usr/bin/env bash
# The wall's ears for Hermes (or any program that runs a command to
# transcribe): what was said in <audio>, written to <text out>.
#
#   scripts/voice/wall-stt.sh <audio file> [<text out>]   (stdout without one)
#
# Any audio ffmpeg reads (Telegram's .ogg, .webm, .m4a, .wav). WALL_URL picks
# the wall (default http://127.0.0.1:3000, this machine); from another
# computer set WALL_TOKEN too (the wall's data/api-token, or a paired device's
# token). docs/voice-server.md
set -euo pipefail

in="${1:?usage: wall-stt.sh <audio file> [<text out>]}"
out="${2:-/dev/stdout}"
url="${WALL_URL:-http://127.0.0.1:3000}"
token="${WALL_TOKEN:-}"
if [[ -z "$token" ]]; then
	here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	[[ -r "$here/data/api-token" ]] && token="$(tr -d '[:space:]' <"$here/data/api-token")"
fi
auth=()
[[ -n "$token" ]] && auth=(-H "Authorization: Bearer $token")

curl -fsS --max-time 120 "${auth[@]}" \
	-F "file=@${in}" -F model=parakeet -F response_format=text \
	"$url/v1/audio/transcriptions" -o "$out"
