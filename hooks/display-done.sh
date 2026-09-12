#!/usr/bin/env bash
# Ping the smart display Dynamic Island when a tool run finishes.
# Usage: display-done.sh [source] [body]
# DISPLAY_HOST defaults to http://localhost:3000
set -euo pipefail

HOST="${DISPLAY_HOST:-http://localhost:3000}"
SOURCE="${1:-Agent}"
BODY="${2:-}"

payload="$(
	node -e 'process.stdout.write(JSON.stringify({ event: "done", source: process.argv[1], body: process.argv[2], severity: "ok" }))' \
		"$SOURCE" "$BODY"
)"

curl -sS -X POST "${HOST%/}/api/notify" \
	-H 'Content-Type: application/json' \
	-d "$payload"
