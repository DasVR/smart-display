#!/bin/bash
# One-time host setup: make this machine discoverable as a Bluetooth speaker
# (A2DP sink role) so a phone can connect and play audio through it, and
# expose the connected phone's AVRCP track metadata as a standard MPRIS
# player (so the existing playerctl-based /api/nowplaying keeps working
# unchanged). Run once on the actual kiosk host — this is infrastructure
# setup, not something the app or CI does for you.
#
# See docs/bluetooth-setup.md for the full picture, verification steps,
# and what to do if pairing or audio routing doesn't behave as expected.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/das/projects/smart-display}"

echo "=== smart-display bluetooth audio setup ==="

echo "[1/6] installing bluez, bluez-tools (mpris-proxy), and the D-Bus agent deps"
sudo apt-get update
sudo apt-get install -y bluez bluez-tools python3-dbus python3-gi

echo "[2/6] setting Bluetooth device class to Audio/Speaker, disabling discoverable/pairable timeouts"
sudo mkdir -p /etc/bluetooth
if ! grep -q "^Class = 0x240414" /etc/bluetooth/main.conf 2>/dev/null; then
	sudo tee -a /etc/bluetooth/main.conf > /dev/null <<'CONF'

[General]
Class = 0x240414
DiscoverableTimeout = 0
PairableTimeout = 0
CONF
fi

echo "[3/6] enabling PipeWire's bluez5 A2DP sink role (so this box RECEIVES audio, i.e. acts as headphones)"
mkdir -p ~/.config/wireplumber/bluetooth.lua.d
cat > ~/.config/wireplumber/bluetooth.lua.d/51-bluez-a2dp-sink.lua <<'LUA'
bluez_monitor.properties["bluez5.roles"] = "a2dp_sink"
bluez_monitor.properties["bluez5.enable-sbc-xq"] = true
LUA

echo "[4/6] installing systemd units (auto-pair agent, connect watcher, mpris bridge)"
sudo cp "$PROJECT_DIR/smart-display-bt-agent.service" /etc/systemd/system/
sudo cp "$PROJECT_DIR/smart-display-bt-watch.service" /etc/systemd/system/
mkdir -p ~/.config/systemd/user
cp "$PROJECT_DIR/smart-display-mpris-proxy.service" ~/.config/systemd/user/

echo "[5/6] restarting bluetooth + pipewire, enabling the new services"
sudo systemctl daemon-reload
sudo systemctl restart bluetooth
sudo systemctl enable --now smart-display-bt-agent.service
sudo systemctl enable --now smart-display-bt-watch.service
systemctl --user daemon-reload
systemctl --user enable --now mpris-proxy.service 2>/dev/null \
	|| systemctl --user enable --now smart-display-mpris-proxy.service
systemctl --user restart wireplumber pipewire pipewire-pulse 2>/dev/null || true

echo "[6/6] powering on the adapter and making it discoverable"
bluetoothctl power on
bluetoothctl discoverable on
bluetoothctl pairable on

cat <<'EOF'

=== done ===
Your phone should now see this device in its Bluetooth list. Pairing
should complete without a PIN prompt (the auto-pair agent accepts it).

Still needed — this script can't detect your hardware for you:
  1. Confirm the analog/headphone-jack output is the DEFAULT sink so the
     phone's audio actually comes out of it:
       wpctl status                 # find the analog output's ID
       wpctl set-default <ID>
  2. Play something on the phone, then check:
       playerctl status             # should report Playing
       playerctl metadata           # should show the phone's track info
     If this is empty, check `systemctl --user status mpris-proxy` (or
     smart-display-mpris-proxy) — see docs/bluetooth-setup.md.

None of this could be tested against real hardware from where it was
written — verify each step against what you actually see.
EOF
