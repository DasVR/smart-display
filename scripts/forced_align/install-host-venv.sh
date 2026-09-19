#!/usr/bin/env bash
# CPU WhisperX + Demucs venv for the das-server *host* (systemd kiosk).
# Not a container, not this Cursor Cloud pod. Bare `pip install whisperx`
# pulls CUDA torch (~2.5 GB) and fights numpy 2. This recipe does not.
#
# The live kiosk checkout is origin/master and does not contain this file.
# Run it from a copy:
#   curl -fsSL -o /tmp/install-host-venv.sh \
#     https://raw.githubusercontent.com/DasVR/smart-display/cursor/whisperx-cpu-host-d064/scripts/forced_align/install-host-venv.sh
#   bash /tmp/install-host-venv.sh --apply-systemd
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

This file is not on origin/master. Download it from the branch, or paste
the same pip commands by hand. Live align.py on master has no whisperx
engine until that code is deployed; the installer still builds the venv.

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
	echo "the live kiosk tree is origin/master and does not ship this script." >&2
	echo "on das-server:" >&2
	echo "  curl -fsSL -o /tmp/install-host-venv.sh https://raw.githubusercontent.com/DasVR/smart-display/cursor/whisperx-cpu-host-d064/scripts/forced_align/install-host-venv.sh" >&2
	echo "  bash /tmp/install-host-venv.sh --apply-systemd" >&2
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

write_drop_in() {
	# Self-contained so a curl'd copy in /tmp still works.
	sudo mkdir -p /etc/systemd/system/smart-display-server.service.d
	sudo tee /etc/systemd/system/smart-display-server.service.d/lyrix.conf >/dev/null <<EOF
[Service]
Environment="LYRICS_PYTHON_BIN=${VENV}/bin/python"
Environment="FORCED_ALIGN_ENGINE=whisperx"
Environment="FORCED_ALIGN_DEVICE=cpu"
Environment="FORCED_ALIGN_WHISPER_MODEL=large-v3"
Environment="FORCED_ALIGN_ALIGN_MODEL=jonatasgrosman/wav2vec2-large-xlsr-53-english"
Environment="FORCED_ALIGN_SEPARATE=1"
Environment="PATH=${VENV}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
EOF
	sudo systemctl daemon-reload
	echo "Wrote systemd drop-in. Restart smart-display-server when ready."
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
echo "Live origin/master align.py has no whisperx engine yet."
echo "Probe after fetching that script, or:"
echo "  $VENV/bin/python /home/das/projects/smart-display/scripts/forced_align/align.py --probe"

if [[ "$APPLY" == 1 ]]; then
	write_drop_in
fi
