#!/bin/bash
# Install playerctl when the dashboard cannot find it. Music metadata and
# the on-screen transport buttons both shell out to this binary.
set -euo pipefail

if command -v playerctl >/dev/null 2>&1; then
	exit 0
fi

export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none
exec /usr/bin/apt-get install -y playerctl
