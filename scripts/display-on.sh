#!/bin/bash
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=$(ls -1 "$XDG_RUNTIME_DIR" | grep -E '^wayland-[0-9]+$' | head -1)
[ -z "$WAYLAND_DISPLAY" ] && WAYLAND_DISPLAY=wayland-0
/usr/bin/wlopm --on HDMI-A-1 2>/dev/null || true
/usr/bin/wlr-randr --output HDMI-A-1 --on 2>/dev/null || true
/usr/bin/wlr-randr --output HDMI-A-1 --mode 1920x1080 2>/dev/null || true
