#!/usr/bin/env bash
# One-shot host setup: speakers, Bluetooth A2DP speaker role, and AirPlay.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/das/projects/smart-display}"

chmod +x \
	"$PROJECT_DIR/scripts/bluetooth-audio-setup.sh" \
	"$PROJECT_DIR/scripts/airplay-setup.sh" \
	"$PROJECT_DIR/scripts/audio-doctor.sh" \
	"$PROJECT_DIR/scripts/audio-pick-sink.mjs" \
	"$PROJECT_DIR/scripts/bt-audio-loopback.sh" \
	"$PROJECT_DIR/scripts/airplay-run.sh" \
	"$PROJECT_DIR/scripts/airplay-started.sh" \
	"$PROJECT_DIR/scripts/airplay-metadata.py"

"$PROJECT_DIR/scripts/bluetooth-audio-setup.sh"
"$PROJECT_DIR/scripts/airplay-setup.sh"

echo "=== picking the real speaker sink ==="
node "$PROJECT_DIR/scripts/audio-pick-sink.mjs" || true

echo
"$PROJECT_DIR/scripts/audio-doctor.sh" || true
