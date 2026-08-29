#!/bin/bash
# Deploy smart-display: called by GitHub Actions self-hosted runner on push to master.
# Builds and restarts the kiosk so the display picks up the latest build.
set -euo pipefail

PROJECT_DIR="/home/das/projects/smart-display"
NPM="/usr/bin/npm"
NODE="/usr/bin/node"

echo "=== smart-display deploy ==="
cd "$PROJECT_DIR"

echo "[1/4] installing deps (npm ci via lockfile)"
"$NPM" ci --no-audit --no-fund

echo "[2/4] building (adapter-node)"
"$NPM" run build

echo "[3/4] restarting dashboard server"
sudo systemctl restart smart-display-server

echo "[4/4] restarting kiosk (cage + chromium)"
sudo systemctl restart smart-display-kiosk

echo "=== deploy complete ==="
