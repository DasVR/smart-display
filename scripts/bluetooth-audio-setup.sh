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

echo "[1/7] installing bluez, bluez-tools (mpris-proxy), D-Bus agent deps, and pactl"
sudo apt-get update
sudo apt-get install -y bluez bluez-tools python3-dbus python3-gi pulseaudio-utils

echo "[2/7] making sure this user can actually open the real ALSA devices"
# /dev/snd/* is root:audio mode 660 — without audio-group membership PipeWire
# can't open any real sound card and silently falls back to a dummy sink,
# no matter how correct the rest of this setup is. Group changes only apply
# to *new* login sessions, so this alone won't fix a session that's already
# running — see the note printed at the end.
if ! id -nG "$USER" | grep -qw audio; then
	sudo usermod -aG audio "$USER"
	NEEDS_RELOGIN=1
else
	NEEDS_RELOGIN=0
fi

echo "[3/7] setting Bluetooth device class to Audio/Speaker, disabling discoverable/pairable timeouts"
sudo mkdir -p /etc/bluetooth
if ! grep -q "^Class = 0x240414" /etc/bluetooth/main.conf 2>/dev/null; then
	sudo tee -a /etc/bluetooth/main.conf > /dev/null <<'CONF'

[General]
Class = 0x240414
DiscoverableTimeout = 0
PairableTimeout = 0
CONF
fi

echo "[4/7] enabling PipeWire as a stereo speaker (A2DP sink only, no headset profile)"
# iPhone / Apple Music will refuse or drop the link if Linux advertises HFP/HSP
# (headset / hands-free). Those profiles are mono call audio, not music.
# WirePlumber 0.5 dropped *.lua snippets; this has to be a .conf file.
rm -rf ~/.config/wireplumber/bluetooth.lua.d
mkdir -p ~/.config/wireplumber/wireplumber.conf.d
cat > ~/.config/wireplumber/wireplumber.conf.d/51-bluez-a2dp-sink.conf <<'CONF'
monitor.bluez.properties = {
  bluez5.roles = [ a2dp_sink ]
  bluez5.hfphsp-backend = "none"
  bluez5.enable-sbc-xq = true
  bluez5.enable-msbc = false
  bluez5.auto-connect = [ a2dp_sink ]
}
CONF
cat > ~/.config/wireplumber/wireplumber.conf.d/51-bluez-no-headset.conf <<'CONF'
wireplumber.settings = {
  bluetooth.autoswitch-to-headset-profile = false
}
CONF

echo "[5/7] installing systemd units (auto-pair agent, connect watcher, mpris bridge)"
sudo cp "$PROJECT_DIR/smart-display-bt-agent.service" /etc/systemd/system/
sudo cp "$PROJECT_DIR/smart-display-bt-watch.service" /etc/systemd/system/
mkdir -p ~/.config/systemd/user
cp "$PROJECT_DIR/smart-display-mpris-proxy.service" ~/.config/systemd/user/

echo "[6/7] restarting bluetooth + pipewire, enabling the new services"
sudo systemctl daemon-reload
sudo systemctl restart bluetooth
sudo systemctl enable --now smart-display-bt-agent.service
sudo systemctl enable --now smart-display-bt-watch.service
sudo systemctl restart smart-display-bt-agent.service smart-display-bt-watch.service
systemctl --user daemon-reload
systemctl --user enable --now mpris-proxy.service 2>/dev/null \
	|| systemctl --user enable --now smart-display-mpris-proxy.service
systemctl --user restart wireplumber pipewire pipewire-pulse 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/bt-audio-loopback.sh" "$PROJECT_DIR/scripts/audio-pick-sink.mjs"

echo "[7/7] powering on the adapter, making it discoverable, and picking speakers"
bluetoothctl power on
bluetoothctl discoverable on
bluetoothctl pairable on
node "$PROJECT_DIR/scripts/audio-pick-sink.mjs" || true

if [ "$NEEDS_RELOGIN" = "1" ]; then
	cat <<'EOF'

*** ACTION NEEDED: reboot (or fully log $USER out and back in) ***
Just-added group memberships don't apply to sessions that are already
running — including the lingering user session PipeWire/WirePlumber run
in. Until that session restarts, PipeWire will keep exposing only a
"Dummy Output" even though the audio group was just added. A reboot is
the simplest way to pick this up; after that, `wpctl status` should show
your real sound card(s) instead of just Dummy Output.
EOF
fi

cat <<'EOF'

=== done ===
Your phone should now see this device in its Bluetooth list as a speaker.
Pairing should complete without a PIN prompt (the auto-pair agent accepts it).
Headset / HFP profiles are off so Apple Music stereo is not refused.

This script now tries to pick analog / USB / headphone over Dummy Output
and HDMI. Confirm with:
  ./scripts/audio-doctor.sh
  wpctl status

Play something on the phone, then:
  playerctl status
  playerctl metadata

If metadata is empty, check `systemctl --user status mpris-proxy`.
For Apple Music, AirPlay to "Smart Display" is the reliable path:
  ./scripts/airplay-setup.sh
  (or the combined ./scripts/speaker-audio-setup.sh)

See docs/bluetooth-setup.md.
EOF
