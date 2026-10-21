#!/usr/bin/env bash
# The wall's senses: install the webcam process on the display (das-server).
#
#   scripts/senses/install.sh                      venv, OpenCV, sherpa-onnx + Parakeet, Phonon (the
#                                                  wall's voice), YOLOX, YuNet
#   scripts/senses/install.sh --wake-word          also openWakeWord and its models
#   HF_TOKEN=hf_… scripts/senses/install.sh --phonon-40m
#                                                  also Phonon's larger voice model (a Hugging Face
#                                                  account that accepted its terms; non-commercial)
#   scripts/senses/install.sh --apply-systemd      install and start smart-display-senses.service
#
# Everything runs on this machine's CPU. The service is only allowed to talk
# to localhost (IPAddressDeny in the unit), so models are fetched here, now,
# and never by the running process. See docs/senses.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="${SENSES_VENV:-$HOME/venvs/senses}"
CACHE="${WALL_SENSES_MODELS:-$HOME/.cache/wall-senses}"
WAKE=0
PHONON40=0
APPLY=0
DRY=0
YUNET_URL="https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
# NVIDIA Parakeet TDT 0.6B v2, int8, packaged for sherpa-onnx (CC-BY-4.0, ~480 MB)
PARAKEET="sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
PARAKEET_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$PARAKEET.tar.bz2"
YOLOX_URL="https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx"

while [[ $# -gt 0 ]]; do
	case "$1" in
		# Whisper is gone from the microphone (Parakeet replaced it): ignore old flags
		--models) echo "note: --models is no longer needed; the microphone uses Parakeet" >&2; shift ;;
		--models=*) echo "note: --models is no longer needed; the microphone uses Parakeet" >&2 ;;
		--wake-word) WAKE=1 ;;
		--phonon-40m) PHONON40=1 ;;
		--apply-systemd) APPLY=1 ;;
		--dry-run) DRY=1 ;;
		-h|--help)
			sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
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

# run it as the wall's own user (das), not with sudo: the venv, the models and
# the service all live under that user's home, and it asks for sudo itself
if [[ "$(id -u)" == 0 && "${SENSES_ALLOW_ROOT:-0}" != 1 ]]; then
	echo "run this as the wall's user, not root:  $0 $*" >&2
	echo "(it uses sudo by itself for --apply-systemd)" >&2
	exit 1
fi

# onnxruntime (OpenCV's and sherpa-onnx's) lags new Pythons: take the newest
# one with wheels (the display's own python3 may be newer than that)
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
run "$VENV/bin/pip" install "numpy>=1.24" "opencv-python-headless>=4.8,<5" "sherpa-onnx>=1.12,<2" "ptts>=0.4,<0.5"
if [[ "$WAKE" == 1 ]]; then
	# without its tflite-runtime dependency, which has no wheel for Python 3.12;
	# the wall only uses openWakeWord's ONNX models
	run "$VENV/bin/pip" install --no-deps "openwakeword>=0.6,<0.7"
	run "$VENV/bin/pip" install "scipy>=1.3,<2" "scikit-learn>=1,<2" "requests>=2,<3" tqdm
	# its pre-trained wake words are CC BY-NC-SA: fine for a home wall, not for selling one
	run "$VENV/bin/python" -c "import openwakeword.utils as u; u.download_models()"
fi

run mkdir -p "$CACHE" "$HOME/.cache/huggingface"
if [[ ! -s "$CACHE/face_detection_yunet_2023mar.onnx" ]]; then
	# OpenCV Zoo, MIT licence: finds faces, knows nobody
	run curl -fsSL "$YUNET_URL" -o "$CACHE/face_detection_yunet_2023mar.onnx"
fi
if [[ ! -s "$CACHE/object_detection_yolox_2022nov.onnx" ]]; then
	# OpenCV Zoo's YOLOX-S, Apache 2.0: whole people in any pose (36 MB)
	run curl -fsSL "$YOLOX_URL" -o "$CACHE/object_detection_yolox_2022nov.onnx"
fi

if [[ ! -s "$CACHE/$PARAKEET/encoder.int8.onnx" ]]; then
	# the speech model: about 0.4 s to hear a command on this CPU (docs/senses.md)
	echo "fetching $PARAKEET (about 480 MB)"
	run curl -fL "$PARAKEET_URL" -o "$CACHE/$PARAKEET.tar.bz2"
	run tar -xjf "$CACHE/$PARAKEET.tar.bz2" -C "$CACHE"
	run rm -f "$CACHE/$PARAKEET.tar.bz2"
fi

# the wall's voice: Phonon 31M (Apache 2.0, 64 MB) and its English voices (26 MB),
# lent to phones, computers and Hermes by the voice box (docs/voice-server.md)
if [[ "$PHONON40" == 1 ]]; then
	run "$VENV/bin/python" "$ROOT/scripts/senses/fetch_phonon.py" "$CACHE" --40m
else
	run "$VENV/bin/python" "$ROOT/scripts/senses/fetch_phonon.py" "$CACHE"
fi
command -v ffmpeg >/dev/null 2>&1 || echo "note: ffmpeg is missing; the voice box then only reads WAV recordings (sudo apt install ffmpeg)"

if ! id -nG | tr ' ' '\n' | grep -qx video; then
	echo "note: $(id -un) is not in the video group; the service adds it (SupplementaryGroups), or: sudo usermod -aG video $(id -un)"
fi

echo
echo "check:"
[[ "$DRY" == 1 ]] || (cd "$ROOT/senses" && "$VENV/bin/python" -m wall_senses --check && "$VENV/bin/python" -m wall_senses --list) || true

if [[ "$APPLY" == 1 ]]; then
	# the unit in the repo is written for das; fill in this user, home and paths
	UNIT="$(mktemp)"
	sed -e "s#/home/das/venvs/senses#$VENV#g" \
		-e "s#/home/das/projects/smart-display#$ROOT#g" \
		-e "s#/home/das/.cache/wall-senses#$CACHE#g" \
		-e "s#/home/das/.cache#$HOME/.cache#g" \
		-e "s#^User=das#User=$(id -un)#" \
		-e "s#/run/user/1000#/run/user/$(id -u)#g" \
		"$ROOT/smart-display-senses.service" >"$UNIT"
	run sudo install -m 0644 "$UNIT" /etc/systemd/system/smart-display-senses.service
	rm -f "$UNIT"
	run sudo systemctl daemon-reload
	run sudo systemctl enable --now smart-display-senses
	run sudo systemctl restart smart-display-senses
	echo "running. Turn the microphone and camera on from the phone: Stats → Senses."
else
	echo "to run it as a service: $0 --apply-systemd"
	echo "or by hand:  cd $ROOT/senses && $VENV/bin/python -m wall_senses"
fi
