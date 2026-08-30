#!/bin/bash
# Deploy smart-display: called by GitHub Actions self-hosted runner on push to master.
# Syncs the live project dir (systemd WorkingDirectory), then builds and restarts.
set -euo pipefail

PROJECT_DIR="/home/das/projects/smart-display"
NPM="/usr/bin/npm"

echo "=== smart-display deploy ==="
cd "$PROJECT_DIR"

echo "[1/5] syncing $PROJECT_DIR to origin/master"
git fetch origin master
git reset --hard origin/master
HEAD_SHA="$(git rev-parse HEAD)"
echo "HEAD $HEAD_SHA $(git log -1 --format=%s)"
if [ -n "${GITHUB_SHA:-}" ] && [ "$HEAD_SHA" != "$GITHUB_SHA" ]; then
	echo "ERROR: project dir $HEAD_SHA does not match workflow $GITHUB_SHA"
	exit 1
fi

echo "[2/5] installing deps (npm ci via lockfile)"
"$NPM" ci --no-audit --no-fund

echo "[3/5] building (adapter-node)"
"$NPM" run build

echo "[4/5] restarting dashboard server"
sudo systemctl restart smart-display-server

echo "[5/5] restarting kiosk (cage + chromium)"
sudo systemctl restart smart-display-kiosk

echo "=== deploy complete ==="
