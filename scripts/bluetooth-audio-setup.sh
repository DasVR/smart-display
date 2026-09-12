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

echo "[1/7] installing bluez, bluez-tools (mpris-proxy), and the D-Bus agent deps"
sudo apt-get update
sudo apt-get install -y bluez bluez-tools python3-dbus python3-gi

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

echo "[4/7] enabling PipeWire's bluez5 A2DP sink role (so this box RECEIVES audio, i.e. acts as headphones)"
# WirePlumber 0.5 dropped support for the old *.lua config format entirely —
# it logs a warning and ignores the file, which silently no-ops this whole
# step. The modern equivalent is a .conf snippet under wireplumber.conf.d/.
rm -rf ~/.config/wireplumber/bluetooth.lua.d
mkdir -p ~/.config/wireplumber/wireplumber.conf.d
cat > ~/.config/wireplumber/wireplumber.conf.d/51-bluez-a2dp-sink.conf <<'CONF'
monitor.bluez.properties = {
  bluez5.roles = [ a2dp_sink a2dp_source bap_sink bap_source hsp_hs hsp_ag hfp_hf hfp_ag ]
  bluez5.enable-sbc-xq = true
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
systemctl --user daemon-reload
systemctl --user enable --now mpris-proxy.service 2>/dev/null \
	|| systemctl --user enable --now smart-display-mpris-proxy.service
systemctl --user restart wireplumber pipewire pipewire-pulse 2>/dev/null || true

echo "[7/7] powering on the adapter and making it discoverable"
bluetoothctl power on
bluetoothctl discoverable on
bluetoothctl pairable on

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
