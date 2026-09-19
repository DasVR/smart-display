#!/usr/bin/env bash
# CPU WhisperX + Demucs venv for the das-server *host* (systemd kiosk).
# Not a container, not this Cursor Cloud pod.
#
# WhisperX 3.8 requires Python >=3.10,<3.14 and numpy>=2.1. The system
# python on das-server is 3.14. Pinning numpy<2 makes pip hunt WhisperX
# 3.3.x, which pins ctranslate2==4.4.0 (no 3.14 wheel). This recipe uses
# python3.12, CPU torch 2.8, and whisperx>=3.7 so pip never takes that path.
#
# Target:  das-server host venv  (~/venvs/lyrix) on Python 3.12
# Device:  CPU (Ryzen iGPU; no NVIDIA CUDA wheels)
set -euo pipefail

VENV="${LYRIX_VENV:-$HOME/venvs/lyrix}"
DRY=0
APPLY=0
RECREATE=0
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY=1 ;;
		--apply-systemd) APPLY=1 ;;
		--recreate) RECREATE=1 ;;
		-h|--help)
			cat <<EOF
Usage: install-host-venv.sh [--dry-run] [--apply-systemd] [--recreate]

Installs a CPU-only lyrix venv on Python 3.12 (WhisperX rejects 3.14):
  python3.12 -m venv \$LYRIX_VENV
  pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
  pip install "whisperx>=3.7,<4" demucs syncedlyrics
  sudo apt-get install -y ffmpeg

A leftover Python 3.14 venv is recreated automatically. Pass --recreate
to wipe any existing venv. Diarization stays off. No HuggingFace token.
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
	echo "on das-server:" >&2
	echo "  /home/das/projects/smart-display/scripts/forced_align/install-host-venv.sh --apply-systemd" >&2
	exit 1
fi

python_ok() {
	local cmd="$1" ver
	command -v "$cmd" >/dev/null || return 1
	ver="$("$cmd" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)" || return 1
	case "$ver" in
		3.10|3.11|3.12|3.13) return 0 ;;
		*) return 1 ;;
	esac
}

pick_python() {
	local cmd
	for cmd in python3.12 python3.11 python3.13 python3.10 python3; do
		if python_ok "$cmd"; then
			command -v "$cmd"
			return 0
		fi
	done
	return 1
}

try_apt_python312() {
	command -v apt-get >/dev/null || return 1
	echo "installing python3.12 from apt (WhisperX rejects 3.14)"
	sudo apt-get update -y
	if sudo apt-get install -y python3.12 python3.12-venv python3.12-dev ffmpeg; then
		return 0
	fi
	echo "default apt has no python3.12; trying deadsnakes"
	sudo apt-get install -y software-properties-common
	sudo add-apt-repository -y ppa:deadsnakes/ppa
	sudo apt-get update -y
	sudo apt-get install -y python3.12 python3.12-venv python3.12-dev ffmpeg
}

PY="$(pick_python || true)"

echo "target: das-server host venv (systemd kiosk, not a container)"
echo "device: cpu (no CUDA torch index)"
echo "venv:   $VENV"
echo "python: ${PY:-MISSING (need 3.10-3.13, not 3.14)}"

plan() {
	cat <<EOF
sudo apt-get install -y python3.12 python3.12-venv python3.12-dev ffmpeg
rm -rf $VENV
${PY:-python3.12} -m venv $VENV
. $VENV/bin/activate
pip install -U pip
pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
pip install "whisperx>=3.7,<4" demucs syncedlyrics
EOF
}

write_drop_in() {
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

if [[ -z "$PY" ]]; then
	if ! try_apt_python312; then
		echo "WhisperX needs Python 3.10-3.13. python3.14 cannot import it." >&2
		echo "Install 3.12, then rerun:" >&2
		echo "  sudo apt-get install -y python3.12 python3.12-venv python3.12-dev ffmpeg" >&2
		echo "  rm -rf $VENV" >&2
		echo "  $0 --apply-systemd --recreate" >&2
		exit 1
	fi
	PY="$(pick_python || true)"
	if [[ -z "$PY" ]]; then
		echo "python3.12 is still missing after apt" >&2
		exit 1
	fi
	echo "python: $PY"
fi

venv_py_ver() {
	if [[ -x "$VENV/bin/python" ]]; then
		"$VENV/bin/python" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true
	fi
}

EXISTING_VER="$(venv_py_ver)"
NEED_VER="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
if [[ "$RECREATE" == 1 ]] || [[ -n "$EXISTING_VER" && "$EXISTING_VER" != "$NEED_VER" ]]; then
	if [[ -z "$VENV" || "$VENV" == "/" ]]; then
		echo "refusing to wipe venv path: ${VENV:-empty}" >&2
		exit 1
	fi
	echo "recreating $VENV (was python ${EXISTING_VER:-none}, need $NEED_VER)"
	rm -rf "$VENV"
fi

mkdir -p "$(dirname "$VENV")"
"$PY" -m venv "$VENV"
# shellcheck disable=SC1091
. "$VENV/bin/activate"
python -m pip install -U pip
python -m pip install "torch==2.8.0" "torchaudio==2.8.0" "torchvision==0.23.0" --index-url https://download.pytorch.org/whl/cpu
PINS="$VENV/lyrix-pins.txt"
python - <<PY
import torch, torchaudio, torchvision
open("$PINS", "w").write(
	f"torch=={torch.__version__}\n"
	f"torchaudio=={torchaudio.__version__}\n"
	f"torchvision=={torchvision.__version__}\n"
)
print(open("$PINS").read().rstrip())
PY
python -m pip install "whisperx>=3.7,<4" syncedlyrics -c "$PINS"
if ! python -m pip install demucs -c "$PINS"; then
	echo "WARN: demucs did not install; vocal isolation stays off" >&2
fi
if command -v apt-get >/dev/null; then
	sudo apt-get install -y ffmpeg
elif ! command -v ffmpeg >/dev/null; then
	echo "WARN: ffmpeg not found; install it before aligning" >&2
fi

echo
"$VENV/bin/python" - <<'PY'
import sys
import numpy
import torch
print("python", sys.version.split()[0])
print("torch", torch.__version__, "cuda", torch.cuda.is_available())
print("numpy", numpy.__version__)
if int(numpy.__version__.split(".")[0]) < 2:
	raise SystemExit("numpy 1.x means pip resolved WhisperX 3.3; wipe the venv and rerun")
import whisperx
print("whisperx", getattr(whisperx, "__version__", "ok"))
if sys.version_info >= (3, 14):
	raise SystemExit("python 3.14 cannot keep WhisperX imported; use 3.12")
PY
if [[ -x "$VENV/bin/demucs" ]]; then
	echo "demucs ok"
else
	echo "demucs missing"
fi
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
echo "Probe:"
echo "  $VENV/bin/python /home/das/projects/smart-display/scripts/forced_align/align.py --probe"

if [[ "$APPLY" == 1 ]]; then
	write_drop_in
fi
