#!/usr/bin/env bash
# Ping the smart display Agents tab when a tool run starts.
# Usage: display-working.sh [source] [body]
# DISPLAY_HOST defaults to http://localhost:3000
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/display-notify.sh" working "${1:-Agent}" "${2:-}" info
