#!/usr/bin/env bash
# Install and start an AirPlay 2 speaker named "Smart Display" so Apple Music
# lists it next to an Apple TV. AirPlay 1 is not enough: current iOS Now
# Playing sheets only show AirPlay 2 receivers.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/das/projects/smart-display}"
AIRPLAY_NAME="${AIRPLAY_NAME:-Smart Display}"
BUILD_DIR="${SHAIRPORT_BUILD_DIR:-/tmp/smart-display-airplay-build}"

echo "=== smart-display AirPlay 2 setup ==="

echo "[1/6] installing avahi, nqptp/shairport build deps, and mDNS tools"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
	avahi-daemon avahi-utils alsa-utils \
	pulseaudio-utils \
	build-essential git autoconf automake libtool pkg-config xmltoman xxd \
	libpopt-dev libconfig-dev libasound2-dev libpulse-dev \
	libavahi-client-dev libssl-dev libsoxr-dev \
	libplist-dev libplist-utils libsodium-dev uuid-dev libgcrypt-dev \
	libavcodec-dev libavformat-dev libavutil-dev libswresample-dev
sudo apt-get install -y --no-install-recommends libpipewire-0.3-dev || true
sudo apt-get install -y --no-install-recommends systemd-dev || true
if ! command -v plistutil >/dev/null 2>&1; then
	echo "ERROR: plistutil is missing (package libplist-utils). AirPlay 2 cannot build." >&2
	exit 1
fi

sudo systemctl enable --now avahi-daemon

if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q 'Status: active'; then
	echo "opening AirPlay / mDNS ports on ufw"
	sudo ufw allow 5353/udp comment 'mDNS' || true
	sudo ufw allow 7000/tcp comment 'AirPlay 2' || true
	sudo ufw allow 319:320/udp comment 'nqptp' || true
	sudo ufw allow 5000/tcp comment 'AirPlay audio' || true
	sudo ufw allow 6001:6010/udp comment 'AirPlay timing' || true
	sudo ufw allow 3278:3289/udp comment 'AirPlay 2 timing' || true
fi

have_airplay2() {
	command -v shairport-sync >/dev/null 2>&1 || return 1
	shairport-sync -V 2>/dev/null | grep -q 'AirPlay2'
}

build_airplay2() {
	echo "[2/6] building nqptp + shairport-sync with AirPlay 2"
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
	sudo systemctl restart nqptp

	git clone --depth 1 https://github.com/mikebrady/shairport-sync.git "$BUILD_DIR/shairport-sync"
	(
		cd "$BUILD_DIR/shairport-sync"
		autoreconf -fi
		# Current shairport-sync renamed --with-pa / --with-systemd.
		flags=(
			--sysconfdir=/etc
			--with-alsa
			--with-pulseaudio
			--with-avahi
			--with-ssl=openssl
			--with-metadata
			--with-metadata-pipe
			--with-systemd-startup
			--with-airplay-2
		)
		if pkg-config --exists soxr; then
			flags+=(--with-soxr)
		fi
		# Native PipeWire backend needs libpipewire 1.1.0. Older 1.0.x still
		# plays through Pulse (pipewire-pulse) with --with-pulseaudio.
		if pkg-config --exists 'libpipewire-0.3 >= 1.1.0'; then
			flags+=(--with-pipewire)
		fi
		./configure "${flags[@]}"
		make
		sudo make install
	)
}

if have_airplay2; then
	echo "[2/6] AirPlay 2 already present ($(command -v shairport-sync))"
	sudo systemctl enable --now nqptp
	sudo systemctl restart nqptp
else
	build_airplay2
fi

if ! have_airplay2; then
	echo "ERROR: shairport-sync is not AirPlay 2. Apple Music will not list this computer." >&2
	echo "Install failed. Check the build log above." >&2
	exit 1
fi

# Distro AirPlay 1 unit would collide on the mDNS name and still not show in Music.
sudo systemctl disable --now shairport-sync.service 2>/dev/null || true

LAN_IFACES="$(node "$PROJECT_DIR/scripts/airplay-lan.mjs" print | tr -d '\n')"
LAN_IFACE="${LAN_IFACES%%,*}"
if [ -n "$LAN_IFACES" ]; then
	echo "pinning Avahi + AirPlay to LAN (${LAN_IFACES})"
	AVAHI_CONF="/etc/avahi/avahi-daemon.conf"
	if [ -f "$AVAHI_CONF" ]; then
		tmp="$(mktemp)"
		cp "$AVAHI_CONF" "$tmp"
		node "$PROJECT_DIR/scripts/airplay-lan.mjs" avahi "$LAN_IFACES" "$tmp"
		sudo cp "$tmp" "$AVAHI_CONF"
		rm -f "$tmp"
		sudo systemctl restart avahi-daemon
	fi
else
	echo "WARNING: no LAN interface found; AirPlay will advertise on every iface including Docker." >&2
fi

echo "[3/6] writing ~/.config/shairport-sync.conf"
mkdir -p "$HOME/.config"
META_PIPE="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/shairport-sync-metadata"
cat > "$HOME/.config/shairport-sync.conf" <<CONF
general = {
  name = "${AIRPLAY_NAME}";
  interpolation = "basic";
  output_backend = "pulseaudio";
  mdns_backend = "avahi";
  ignore_volume_control = "no";
$( [ -n "$LAN_IFACE" ] && printf '  interface = "%s";\n' "$LAN_IFACE" )
};

sessioncontrol = {
  run_this_before_play_begins = "${PROJECT_DIR}/scripts/airplay-started.sh";
  wait_for_completion = "no";
  allow_session_interruption = "yes";
  session_timeout = 120;
};

pulseaudio = {
  application_name = "Shairport Sync";
};

metadata = {
  enabled = "yes";
  include_cover_art = "yes";
  pipe_name = "${META_PIPE}";
  pipe_timeout = 5000;
};
CONF

echo "[4/6] installing user units"
mkdir -p "$HOME/.config/systemd/user"
cp "$PROJECT_DIR/smart-display-airplay.service" "$HOME/.config/systemd/user/"
cp "$PROJECT_DIR/smart-display-airplay-meta.service" "$HOME/.config/systemd/user/"
chmod +x "$PROJECT_DIR/scripts/airplay-run.sh" \
	"$PROJECT_DIR/scripts/airplay-started.sh" \
	"$PROJECT_DIR/scripts/airplay-metadata.py"

echo "[5/6] enabling AirPlay user services"
systemctl --user daemon-reload
systemctl --user enable --now smart-display-airplay.service
systemctl --user enable --now smart-display-airplay-meta.service
systemctl --user restart smart-display-airplay.service smart-display-airplay-meta.service

echo "[6/6] checking that ${AIRPLAY_NAME} is advertising on mDNS"
sleep 3
systemctl --user --no-pager --full status smart-display-airplay.service || true
systemctl --no-pager --full status nqptp || true
echo "--- avahi AirPlay browse ---"
if command -v avahi-browse >/dev/null 2>&1; then
	timeout 8 avahi-browse -prt _airplay._tcp || true
	if timeout 8 avahi-browse -prt _airplay._tcp 2>/dev/null | grep -qi "${AIRPLAY_NAME}"; then
		echo "mDNS is publishing ${AIRPLAY_NAME}."
	else
		echo "WARNING: avahi-browse did not see ${AIRPLAY_NAME} yet. Apple Music will stay empty until it does." >&2
		echo "Phone and kiosk must be on the same LAN. Wait ~10s and reopen the AirPlay list." >&2
	fi
fi

echo
echo "AirPlay 2 is running. In Apple Music, tap the AirPlay icon and choose ${AIRPLAY_NAME}."
echo "It appears as a speaker row under iPhone Speaker, same list as an Apple TV."
