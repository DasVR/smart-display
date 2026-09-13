#!/usr/bin/env bash
# Ping the smart display Dynamic Island when a tool run finishes.
# Usage: display-done.sh [source] [body]
# DISPLAY_HOST defaults to http://localhost:3000
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/display-notify.sh" done "${1:-Agent}" "${2:-}" ok
