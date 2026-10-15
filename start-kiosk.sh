#!/bin/bash
# The kiosk: cage (a one-window Wayland compositor) running the browser full
# screen. The browser opens static/boot.html from disk, so the standby light
# is on screen in its first frame, server or no server; it hands over to the
# wall's page the moment the server answers. Boot path and timings: docs/boot.md.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1
export WLR_BACKENDS=drm,libinput
export WLR_LIBINPUT_NO_DEVICES=1

WALL_URL="${WALL_URL:-http://localhost:3000}"
OUTPUT="${KIOSK_OUTPUT:-HDMI-A-1}"
MODE="${KIOSK_MODE:-1920x1080}"

# A regular package starts in about a second; Ubuntu's snap Chromium takes
# several on a cold boot. KIOSK_BROWSER picks one by hand.
pick_browser() {
	for b in "${KIOSK_BROWSER:-}" /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do
		if [ -n "$b" ] && [ -x "$b" ]; then
			echo "$b"
			return
		fi
	done
	echo /usr/bin/chromium-browser
}
BROWSER="$(pick_browser)"

# deploys reload the page instead of restarting all this, unless this file changed (scripts/deploy.sh)
sha256sum "$ROOT/start-kiosk.sh" >"$XDG_RUNTIME_DIR/smart-display-kiosk.sha" 2>/dev/null || true

/usr/bin/cage -s -- \
	"$BROWSER" \
	--enable-features=UseOzonePlatform \
	--ozone-platform=wayland \
	--kiosk \
	--app="file://$ROOT/static/boot.html?to=$WALL_URL" \
	--disable-features=TranslateUI,MediaRouter,OptimizationHints \
	--disable-infobars \
	--disable-session-crashed-bubble \
	--disable-restore-session-state \
	--noerrdialogs \
	--hide-scrollbars \
	--autoplay-policy=no-user-gesture-required \
	--incognito \
	--disk-cache-dir=/dev/null \
	--user-data-dir=/tmp/chromium-kiosk-cache \
	--disk-cache-size=1 \
	--media-cache-size=1 \
	--aggressive-cache-discard \
	--no-first-run \
	--no-default-browser-check \
	--disable-background-networking \
	--disable-component-update \
	--disable-sync \
	--disable-extensions \
	--disable-default-apps \
	--password-store=basic \
	--check-for-update-interval=31536000 \
	--remote-debugging-port=9222 \
	--remote-allow-origins=http://localhost:9222 &

CAGE_PID=$!

# once cage is up: the right mode (only if it isn't already: every mode change
# makes a TV re-sync for a second or two), and back off if it was off before
(
	for _ in $(seq 1 60); do
		WAYLAND_DISPLAY=$(ls -1 "$XDG_RUNTIME_DIR" 2>/dev/null | grep -E '^wayland-[0-9]+$' | head -1)
		export WAYLAND_DISPLAY
		if [ -n "$WAYLAND_DISPLAY" ] && [ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then
			if ! /usr/bin/wlr-randr 2>/dev/null | grep -A40 "^$OUTPUT" | grep -q "^ *$MODE px.*current"; then
				/usr/bin/wlr-randr --output "$OUTPUT" --mode "$MODE" || true
			fi
			STAMP="${XDG_RUNTIME_DIR}/smart-display-hdmi"
			if [ -f "$STAMP" ] && grep -qx off "$STAMP"; then
				"$ROOT/scripts/display-off.sh" || true
			fi
			break
		fi
		sleep 0.25
	done
) &

wait $CAGE_PID
