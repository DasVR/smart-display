#!/usr/bin/env bash
# Install and start an AirPlay speaker named "Smart Display" so Apple Music
# can hand off audio the same way it does to a TV. Prefers AirPlay 2
# (nqptp + shairport-sync built from source). Falls back to the distro
# AirPlay 1 package if that build cannot run here.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/das/projects/smart-display}"
AIRPLAY_NAME="${AIRPLAY_NAME:-Smart Display}"
BUILD_DIR="${SHAIRPORT_BUILD_DIR:-/tmp/smart-display-airplay-build}"

echo "=== smart-display AirPlay setup ==="

echo "[1/5] installing avahi and build deps"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
	avahi-daemon \
	pulseaudio-utils \
	build-essential git autoconf automake libtool pkg-config xmltoman \
	libpopt-dev libconfig-dev libasound2-dev libpulse-dev \
	libavahi-client-dev libssl-dev libsoxr-dev \
	libplist-dev libsodium-dev libavcodec-dev libavformat-dev \
	libavutil-dev libswresample-dev
sudo apt-get install -y --no-install-recommends libpipewire-0.3-dev || true

sudo systemctl enable --now avahi-daemon

have_airplay2() {
	command -v shairport-sync >/dev/null 2>&1 || return 1
	shairport-sync -V 2>/dev/null | grep -q 'AirPlay2'
}

build_airplay2() {
	echo "[2/5] building nqptp + shairport-sync with AirPlay 2"
	rm -rf "$BUILD_DIR"
	mkdir -p "$BUILD_DIR"

	git clone --depth 1 https://github.com/mikebrady/nqptp.git "$BUILD_DIR/nqptp"
	(
		cd "$BUILD_DIR/nqptp"
		autoreconf -fi
		./configure --with-systemd-startup
		make
		sudo make install
	)
	sudo systemctl daemon-reload
	sudo systemctl enable --now nqptp

	git clone --depth 1 https://github.com/mikebrady/shairport-sync.git "$BUILD_DIR/shairport-sync"
	(
		cd "$BUILD_DIR/shairport-sync"
		autoreconf -fi
		flags=(--sysconfdir=/etc --with-alsa --with-pa --with-avahi --with-ssl=openssl --with-metadata --with-systemd --with-airplay-2)
		if pkg-config --exists soxr; then
			flags+=(--with-soxr)
		fi
		if pkg-config --exists libpipewire-0.3; then
			flags+=(--with-pipewire)
		fi
		./configure "${flags[@]}"
		make
		sudo make install
	)
}

if [ "${SHAIRPORT_SKIP_AIRPLAY2:-0}" = "1" ]; then
	echo "[2/5] skipping AirPlay 2 build (SHAIRPORT_SKIP_AIRPLAY2=1)"
	sudo apt-get install -y shairport-sync
elif have_airplay2; then
	echo "[2/5] AirPlay 2 already present ($(command -v shairport-sync))"
	sudo systemctl enable --now nqptp 2>/dev/null || true
else
	if ! build_airplay2; then
		echo "AirPlay 2 build failed; installing distro shairport-sync (AirPlay 1)" >&2
		sudo apt-get install -y shairport-sync
	fi
fi

# Distro unit runs as its own user and would collide on the mDNS name.
sudo systemctl disable --now shairport-sync.service 2>/dev/null || true

echo "[3/5] writing ~/.config/shairport-sync.conf"
mkdir -p "$HOME/.config"
META_PIPE="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/shairport-sync-metadata"
cat > "$HOME/.config/shairport-sync.conf" <<CONF
general = {
  name = "${AIRPLAY_NAME}";
  interpolation = "basic";
  output_backend = "pa";
  ignore_volume_control = "no";
};

sessioncontrol = {
  run_this_before_play_begins = "${PROJECT_DIR}/scripts/airplay-started.sh";
};

pa = {
  application_name = "Shairport Sync";
};

metadata = {
  enabled = "yes";
  include_cover_art = "yes";
  pipe_name = "${META_PIPE}";
  pipe_timeout = 5000;
};
CONF

echo "[4/5] installing user units"
mkdir -p "$HOME/.config/systemd/user"
cp "$PROJECT_DIR/smart-display-airplay.service" "$HOME/.config/systemd/user/"
cp "$PROJECT_DIR/smart-display-airplay-meta.service" "$HOME/.config/systemd/user/"
chmod +x "$PROJECT_DIR/scripts/airplay-run.sh" \
	"$PROJECT_DIR/scripts/airplay-started.sh" \
	"$PROJECT_DIR/scripts/airplay-metadata.py"

echo "[5/5] enabling AirPlay user services"
systemctl --user daemon-reload
systemctl --user enable --now smart-display-airplay.service
systemctl --user enable --now smart-display-airplay-meta.service
systemctl --user restart smart-display-airplay.service smart-display-airplay-meta.service

echo
if command -v shairport-sync >/dev/null 2>&1 && shairport-sync -V 2>/dev/null | grep -q AirPlay2; then
	echo "AirPlay 2 is ready. In Apple Music, tap the AirPlay icon and choose ${AIRPLAY_NAME}."
else
	echo "AirPlay 1 is ready (distro package). Apple Music still lists ${AIRPLAY_NAME} as a speaker."
	echo "TV-style AirPlay 2 handoff needs the source build; re-run without SHAIRPORT_SKIP_AIRPLAY2=1."
fi
