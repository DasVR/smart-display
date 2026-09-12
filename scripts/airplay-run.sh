#!/usr/bin/env bash
set -euo pipefail
CONF="${HOME}/.config/shairport-sync.conf"
BIN=""
for cand in /usr/local/bin/shairport-sync /usr/bin/shairport-sync; do
	if [ -x "$cand" ]; then
		BIN="$cand"
		break
	fi
done
if [ -z "$BIN" ]; then
	BIN="$(command -v shairport-sync || true)"
fi
if [ -z "$BIN" ]; then
	echo "shairport-sync is not installed" >&2
	exit 1
fi
exec "$BIN" -c "$CONF"
