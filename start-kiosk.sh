#!/bin/bash
set -e

export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1
export WLR_BACKENDS=drm,libinput
export WLR_LIBINPUT_NO_DEVICES=1

/usr/bin/cage -s -- \
  /usr/bin/chromium-browser \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --kiosk \
  --app=http://localhost:3000 \
  --disable-features=TranslateUI \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --noerrdialogs \
  --hide-scrollbars \
  --autoplay-policy=no-user-gesture-required \
  --incognito \
  --disk-cache-dir=/dev/null \
  --user-data-dir=/tmp/chromium-kiosk-cache \\
  --disk-cache-size=1 \
  --media-cache-size=1 \
  --aggressive-cache-discard \\
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking &

CAGE_PID=$!

# wait for cage to create the wayland socket
for i in {1..30}; do
  if [ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then
    sleep 1
    /usr/bin/wlr-randr --output HDMI-A-1 --mode 1920x1080 || true
    break
  fi
  sleep 0.5
done

wait $CAGE_PID
