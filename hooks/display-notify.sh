#!/usr/bin/env bash
# Ping the smart display Dynamic Island for a named event.
# Usage: display-notify.sh <event> [source] [body] [severity]
# Events: done, install, update
# DISPLAY_HOST defaults to http://localhost:3000
set -euo pipefail

HOST="${DISPLAY_HOST:-http://localhost:3000}"
EVENT="${1:-done}"
SOURCE="${2:-}"
BODY="${3:-}"
SEVERITY="${4:-}"

payload="$(
	node -e '
		const event = process.argv[1];
		const source = process.argv[2];
		const body = process.argv[3];
		const severity = process.argv[4];
		const data = { event, source, body };
		if (severity) data.severity = severity;
		process.stdout.write(JSON.stringify(data));
	' "$EVENT" "$SOURCE" "$BODY" "$SEVERITY"
)"

curl -sS -X POST "${HOST%/}/api/notify" \
	-H 'Content-Type: application/json' \
	-d "$payload"
