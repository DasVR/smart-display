#!/bin/bash
# Deploy smart-display: called by GitHub Actions self-hosted runner on push to master.
# Syncs the live project dir (systemd WorkingDirectory), then builds and restarts.
set -euo pipefail

PROJECT_DIR="${SMART_DISPLAY_DIR:-/home/das/projects/smart-display}"
NPM="${SMART_DISPLAY_NPM:-/usr/bin/npm}"
LOCK="${SMART_DISPLAY_LOCK:-/tmp/smart-display-kiosk.lock}"

# Resolve next to this file BEFORE cd. GitHub Actions runs
# ./scripts/deploy.sh from the runner checkout, so $0 is relative.
# After cd into the live kiosk clone, that same relative path points at
# the previous checkout, which may not have scripts/lib yet (#98's
# helper never reached the display because deploy died sourcing it).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Serialize against Bluetooth Audio Setup, which git-resets the same dir
# and restarts PipeWire. Overlapping merges were failing kiosk restarts
# because cage lost the DRM device mid-start.
exec 9>"$LOCK"
if ! flock -w 600 9; then
	echo "ERROR: could not acquire $LOCK after 600s"
	exit 1
fi

echo "=== smart-display deploy ==="

# A crashed git (or a stray status/commit on the kiosk checkout) can leave
# .git/index.lock behind. fetch succeeds; reset --hard then dies in a few
# seconds and the display never picks up master. Wait briefly, then drop a
# leftover lock and retry.
# shellcheck source=scripts/lib/git-index-lock.sh
. "$SCRIPT_DIR/lib/git-index-lock.sh"

cd "$PROJECT_DIR"

echo "[1/5] syncing $PROJECT_DIR to origin/master"
sync_ok=0
for attempt in 1 2 3; do
	wait_and_clear_index_lock
	git fetch origin master
	if git reset --hard origin/master; then
		sync_ok=1
		break
	fi
	echo "WARN: git reset failed (attempt ${attempt}/3)"
	sleep 2
done
if [ "$sync_ok" != 1 ]; then
	echo "ERROR: could not reset $PROJECT_DIR to origin/master"
	exit 1
fi
HEAD_SHA="$(git rev-parse HEAD)"
echo "HEAD $HEAD_SHA $(git log -1 --format=%s)"
if [ -n "${GITHUB_SHA:-}" ] && [ "$HEAD_SHA" != "$GITHUB_SHA" ]; then
	echo "ERROR: project dir $HEAD_SHA does not match workflow $GITHUB_SHA"
	exit 1
fi

if [ -f scripts/sudoers.d/smart-display-host-upgrade ]; then
	chmod +x scripts/host-upgrade.sh || true
	if sudo visudo -cf scripts/sudoers.d/smart-display-host-upgrade >/dev/null 2>&1; then
		sudo install -m 440 scripts/sudoers.d/smart-display-host-upgrade /etc/sudoers.d/smart-display-host-upgrade
	else
		echo "WARN: host-upgrade sudoers file failed visudo; package installs stay manual"
	fi
fi

echo "[2/5] installing deps (npm ci via lockfile)"
"$NPM" ci --no-audit --no-fund

echo "[3/5] building (adapter-node)"
"$NPM" run build

echo "[4/5] restarting dashboard server"
sudo systemctl restart smart-display-server
sudo systemctl is-active --quiet smart-display-server
for _ in 1 2 3 4 5 6 7 8; do
	curl -sf -o /dev/null http://127.0.0.1:3000/api/display && break
	sleep 1
done

echo "[5/5] restarting kiosk (cage + chromium)"
kiosk_ok=0
for attempt in 1 2 3 4 5; do
	sudo systemctl reset-failed smart-display-kiosk || true
	if sudo systemctl restart smart-display-kiosk; then
		kiosk_ok=1
		break
	fi
	echo "kiosk restart attempt ${attempt} failed; waiting for DRM"
	sleep 4
done
if [ "$kiosk_ok" != 1 ]; then
	echo "WARN: kiosk compositor did not come back; dashboard server is up"
	sudo systemctl --no-pager --full status smart-display-kiosk || true
fi

echo "=== deploy complete ==="
