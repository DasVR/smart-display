#!/bin/bash
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1
/usr/bin/wlr-randr --output HDMI-A-1 --off 2>/dev/null || true
