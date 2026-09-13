#!/bin/bash
# Apply OS package or firmware updates. Invoked passwordless via sudo -n
# from the dashboard. Does not run apt-get update (uses existing lists).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none
export NEEDRESTART_MODE="${NEEDRESTART_MODE:-l}"

TARGET="${1:-packages}"

if [ "$TARGET" = "firmware" ]; then
	exec /usr/bin/fwupdmgr update --assume-yes --no-reboot-check --no-unattended-check
fi

if [ "$TARGET" != "packages" ]; then
	echo "usage: host-upgrade.sh packages|firmware" >&2
	exit 2
fi

exec /usr/bin/apt-get -yq --with-new-pkgs \
	-o Dpkg::Options::=--force-confold \
	-o Dpkg::Options::=--force-confdef \
	-o APT::Status-Fd=2 \
	-o Dpkg::Use-Pty=0 \
	upgrade
