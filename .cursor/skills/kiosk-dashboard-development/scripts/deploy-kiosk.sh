#!/bin/bash
# Deploy smart-display: called by GitHub Actions self-hosted runner on push to master.
# Builds and restarts the kiosk so the display picks up the latest build.
set -euo pipefail

PROJECT_DIR="/home/das/projects/smart-display"
NPM="/usr/bin/npm"
NODE="/usr/bin/node"

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

echo "[2/4] building (adapter-node)"
"$NPM" run build

echo "[3/4] restarting dashboard server"
sudo systemctl restart smart-display-server

echo "[4/4] restarting kiosk (cage + chromium)"
sudo systemctl restart smart-display-kiosk

echo "=== deploy complete ==="
