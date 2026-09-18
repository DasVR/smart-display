#!/usr/bin/env bash
# CPU WhisperX + Demucs venv for the das-server *host* (systemd kiosk).
# Not a container, not this Cursor Cloud pod. Bare `pip install whisperx`
# pulls CUDA torch (~2.5 GB) and fights numpy 2. This recipe does not.
#
# Target:  das-server host venv  (~/venvs/lyrix)
# Device:  CPU (Ryzen iGPU; no NVIDIA CUDA wheels)
set -euo pipefail

VENV="${LYRIX_VENV:-$HOME/venvs/lyrix}"
DRY=0
APPLY=0
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY=1 ;;
		--apply-systemd) APPLY=1 ;;
		-h|--help)
			cat <<EOF
Usage: install-host-venv.sh [--dry-run] [--apply-systemd]

Installs a CPU-only lyrix venv on the kiosk host:
  python3 -m venv \$LYRIX_VENV
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
  pip install "numpy<2" whisperx demucs syncedlyrics
  sudo apt-get install -y ffmpeg

Refuses to run inside the Cursor Cloud agent pod unless LYRIX_ALLOW_CLOUD=1.
Diarization stays off. No HuggingFace token is required.
lyricsgenius is not installed: Genius is an unsynced optional sheet.
EOF
			exit 0
			;;
		*)
			echo "unknown arg: $arg" >&2
			exit 2
			;;
	esac
done

looks_like_cloud_pod() {
	[[ -d /opt/cursor ]] || [[ "$(hostname -s 2>/dev/null || hostname)" == cursor ]]
}

if looks_like_cloud_pod && [[ "${LYRIX_ALLOW_CLOUD:-0}" != "1" ]] && [[ "$DRY" != 1 ]]; then
	echo "refusing: this looks like the Cursor Cloud pod, not das-server" >&2
	echo "run on the kiosk host as user das:" >&2
	echo "  /home/das/projects/smart-display/scripts/forced_align/install-host-venv.sh" >&2
	exit 1
fi

echo "target: das-server host venv (systemd kiosk, not a container)"
echo "device: cpu (no CUDA torch index)"
echo "venv:   $VENV"

plan() {
	cat <<EOF
python3 -m venv $VENV
. $VENV/bin/activate
pip install -U pip
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install "numpy<2" whisperx demucs syncedlyrics
sudo apt-get install -y ffmpeg
EOF
}

if [[ "$DRY" == 1 ]]; then
	plan
	exit 0
fi

if ! command -v python3 >/dev/null; then
	echo "python3 is required" >&2
	exit 1
fi

mkdir -p "$(dirname "$VENV")"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
. "$VENV/bin/activate"
python -m pip install -U pip
python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
python -m pip install "numpy<2" whisperx demucs syncedlyrics
if command -v apt-get >/dev/null; then
	sudo apt-get install -y ffmpeg
elif ! command -v ffmpeg >/dev/null; then
	echo "WARN: ffmpeg not found; install it before aligning" >&2
fi

echo
"$VENV/bin/python" - <<'PY'
import numpy
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available())
print("numpy", numpy.__version__)
import whisperx
print("whisperx", getattr(whisperx, "__version__", "ok"))
PY
echo "demucs $($VENV/bin/demucs -h >/dev/null && echo ok || echo missing)"
echo "ffmpeg $(command -v ffmpeg || echo missing)"
echo
echo "Point the kiosk at this interpreter:"
echo "  LYRICS_PYTHON_BIN=$VENV/bin/python"
echo "  FORCED_ALIGN_ENGINE=whisperx"
echo "  FORCED_ALIGN_DEVICE=cpu"
echo "  FORCED_ALIGN_WHISPER_MODEL=large-v3"
echo "  FORCED_ALIGN_ALIGN_MODEL=jonatasgrosman/wav2vec2-large-xlsr-53-english"
echo "  FORCED_ALIGN_SEPARATE=1"
echo
echo "First align downloads faster-whisper large-v3. Diarization is off."
echo "Probe: LYRICS_PYTHON_BIN=$VENV/bin/python python3 scripts/forced_align/align.py --probe"

HERE="$(cd "$(dirname "$0")" && pwd)"
DROP_IN_SRC="$HERE/smart-display-server.lyrix.conf"
if [[ "$APPLY" == 1 ]]; then
	sudo mkdir -p /etc/systemd/system/smart-display-server.service.d
	# Rewrite the venv path in case LYRIX_VENV was overridden.
	sed "s|/home/das/venvs/lyrix|$VENV|g" "$DROP_IN_SRC" | sudo tee /etc/systemd/system/smart-display-server.service.d/lyrix.conf >/dev/null
	sudo systemctl daemon-reload
	echo "Wrote systemd drop-in. Restart smart-display-server when ready."
fi
