#!/usr/bin/env bash
# The wall's senses: install the webcam process on the display (das-server).
#
#   scripts/senses/install.sh                      venv, OpenCV, faster-whisper, YuNet, base.en
#   scripts/senses/install.sh --models tiny.en,small.en   also fetch these Whisper models
#   scripts/senses/install.sh --wake-word          also openWakeWord and its models
#   scripts/senses/install.sh --apply-systemd      install and start smart-display-senses.service
#
# Everything runs on this machine's CPU. The service is only allowed to talk
# to localhost (IPAddressDeny in the unit), so models are fetched here, now,
# and never by the running process. See docs/senses.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="${SENSES_VENV:-$HOME/venvs/senses}"
CACHE="${WALL_SENSES_MODELS:-$HOME/.cache/wall-senses}"
MODELS="base.en"
WAKE=0
APPLY=0
DRY=0
YUNET_URL="https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--models) MODELS="base.en,$2"; shift ;;
		--models=*) MODELS="base.en,${1#*=}" ;;
		--wake-word) WAKE=1 ;;
		--apply-systemd) APPLY=1 ;;
		--dry-run) DRY=1 ;;
		-h|--help)
			sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*) echo "unknown arg: $1" >&2; exit 2 ;;
	esac
	shift
done

run() {
	echo "+ $*"
	[[ "$DRY" == 1 ]] || "$@"
}

# faster-whisper's CTranslate2 and onnxruntime lag new Pythons: take the
# newest one they support (the display's own python3 is newer than that)
PY=""
for v in python3.12 python3.13 python3.11 python3.10 python3; do
	if command -v "$v" >/dev/null 2>&1; then PY="$v"; break; fi
done
[[ -n "$PY" ]] || { echo "no python3 found" >&2; exit 1; }
echo "using $PY ($($PY --version 2>&1)) for $VENV"

command -v parec >/dev/null 2>&1 || echo "note: parec is missing; install pulseaudio-utils (PipeWire serves it)"

if [[ ! -x "$VENV/bin/python" ]]; then
	run "$PY" -m venv "$VENV"
fi
run "$VENV/bin/pip" install --upgrade pip
run "$VENV/bin/pip" install "numpy>=1.24" "opencv-python-headless>=4.8,<5" "faster-whisper>=1.0,<2"
if [[ "$WAKE" == 1 ]]; then
	run "$VENV/bin/pip" install "openwakeword>=0.6,<0.7"
	# its pre-trained wake words are CC BY-NC-SA: fine for a home wall, not for selling one
	run "$VENV/bin/python" -c "import openwakeword.utils as u; u.download_models()"
fi

run mkdir -p "$CACHE" "$HOME/.cache/huggingface"
if [[ ! -s "$CACHE/face_detection_yunet_2023mar.onnx" ]]; then
	# OpenCV Zoo, MIT licence: finds faces, knows nobody
	run curl -fsSL "$YUNET_URL" -o "$CACHE/face_detection_yunet_2023mar.onnx"
fi

IFS=',' read -r -a WANT <<<"$MODELS"
for m in $(printf '%s\n' "${WANT[@]}" | awk 'NF && !seen[$0]++'); do
	echo "fetching Whisper $m"
	run "$VENV/bin/python" -c "from faster_whisper import WhisperModel; WhisperModel('$m', device='cpu', compute_type='int8')"
done

if ! id -nG | tr ' ' '\n' | grep -qx video; then
	echo "note: $(id -un) is not in the video group; the service adds it (SupplementaryGroups), or: sudo usermod -aG video $(id -un)"
fi

echo
echo "check:"
[[ "$DRY" == 1 ]] || (cd "$ROOT/senses" && "$VENV/bin/python" -m wall_senses --check && "$VENV/bin/python" -m wall_senses --list) || true

if [[ "$APPLY" == 1 ]]; then
	UNIT="$ROOT/smart-display-senses.service"
	run sudo install -m 0644 "$UNIT" /etc/systemd/system/smart-display-senses.service
	run sudo systemctl daemon-reload
	run sudo systemctl enable --now smart-display-senses
	run sudo systemctl restart smart-display-senses
	echo "running. Turn the microphone and camera on from the phone: Stats → Senses."
else
	echo "to run it as a service: $0 --apply-systemd"
	echo "or by hand:  cd $ROOT/senses && $VENV/bin/python -m wall_senses"
fi
