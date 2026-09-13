# Phone audio: Bluetooth, AirPlay, and speakers

Lets a phone play through this kiosk: Apple Music via AirPlay (the same
speaker handoff you get on a TV), Bluetooth as a stereo speaker fallback,
and a doctor script that says whether the speakers are actually the
default output.

Phone-to-speaker audio was never confirmed on the real box after the
`audio` group fix. iPhone + Apple Music in particular often "does not
allow" playback when Linux advertises a headset profile (HFP) instead of
A2DP. This pass locks Bluetooth to A2DP sink only, loops the phone's
stream onto the default speakers, auto-picks analog/USB/headphone over
Dummy Output, and adds an AirPlay receiver named **Smart Display**.

## What to use from the phone

**Apple Music: AirPlay (preferred).** Open Apple Music, tap the AirPlay
icon on Now Playing (or Control Center -> AirPlay), and choose
`Smart Display`. That is the TV-style handoff. It is AirPlay, not Apple
Continuity Handoff (Continuity is Apple-only and cannot run on Linux).

**Bluetooth:** pair the kiosk from iOS Settings -> Bluetooth. It should
show as a speaker, not a headset. Then play. If Apple Music still
refuses the route, use AirPlay.

## How the pieces fit together

1. **Speakers** — `scripts/audio-pick-sink.mjs` reads `wpctl status`,
   prefers analog / headphones / USB, skips Dummy Output, and falls back
   to HDMI only when that is the only real sink. `wpctl set-default`
   persists the choice in WirePlumber.
2. **Bluetooth pairing** — `scripts/bt-auto-agent.py` accepts every
   pairing request without a PIN (`smart-display-bt-agent.service`).
3. **Bluetooth audio** — WirePlumber is A2DP sink only (`hfphsp-backend
   = none`). Headset profiles are what make iPhone stereo fail. After
   connect, `scripts/bt-audio-loopback.sh` plays the `bluez_input.*`
   source on the default sink.
4. **Track metadata (Bluetooth)** — `mpris-proxy` still bridges AVRCP to
   MPRIS so `playerctl` / `/api/nowplaying` work.
5. **AirPlay 2** — `shairport-sync` advertises `Smart Display` over mDNS
   (Avahi) with `nqptp`. Current Apple Music Now Playing sheets only
   list AirPlay 2 receivers (the same list as an Apple TV). AirPlay 1
   is not used. Playback goes through PipeWire Pulse, so it uses the
   same default sink as Bluetooth.
6. **Auto-switch to Music** — Bluetooth `POST /api/bt/connected` and
   AirPlay `POST /api/airplay/connected` both jump the dashboard to Music
   and raise the Dynamic Island.
7. **AirPlay now-playing** — `scripts/airplay-metadata.py` reads the
   shairport metadata pipe so title/artist/art show when MPRIS is empty.

## Setup

On the kiosk host:

```bash
cd /home/das/projects/smart-display
./scripts/speaker-audio-setup.sh
```

That runs Bluetooth setup, AirPlay 2 setup, sink picking, then
`./scripts/audio-doctor.sh`.

A dashboard deploy (`Deploy + Reboot Display`) does **not** start the
AirPlay speaker. Watch **Bluetooth Audio Setup** on GitHub Actions.
When that job is green, reopen Apple Music: **Smart Display** should
appear under iPhone Speaker, same list as the TV. If the job is red, the
speaker is not on the network yet.

**If it just added you to the `audio` group, reboot** (or fully log out
and back in) before testing sound. PipeWire's already-running session
will keep showing Dummy Output until then.

Pieces on their own:

```bash
./scripts/bluetooth-audio-setup.sh
./scripts/airplay-setup.sh
./scripts/audio-pick-sink.mjs          # also --dry-run or --beep
./scripts/audio-doctor.sh              # also --fix and --beep
```

## Verifying speakers are connected

```bash
./scripts/audio-doctor.sh
```

You want:

- `audio group: yes`
- a real card in `/proc/asound/cards` / `aplay -l`
- `speakers: connected via ... (analog|headphone|usb|hdmi)`
- **not** Dummy Output as the default sink
- AirPlay unit active; `shairport-sync -V` includes `AirPlay2` if the
  TV-style path built cleanly
- Avahi active (phones cannot see the speaker without mDNS)

Play a confirmation sound on whatever was picked:

```bash
node ./scripts/audio-pick-sink.mjs --beep
```

## Verifying Bluetooth

```bash
bluetoothctl info <phone MAC>          # Connected: yes
playerctl status                       # Playing
playerctl metadata
curl -X POST http://localhost:3000/api/bt/connected
```

If the phone pairs but music is silent, check that a `bluez` source
exists (`pactl list short sources`) and that the loopback script loaded
(`pactl list short modules | grep loopback`). Re-run
`./scripts/bt-audio-loopback.sh`.

## Verifying AirPlay

```bash
systemctl --user status smart-display-airplay
systemctl is-active avahi-daemon
systemctl is-active nqptp
avahi-browse -rt _airplay._tcp
curl -X POST http://localhost:3000/api/airplay/connected
```

On the iPhone, **Smart Display** should appear in the same Apple Music
sheet as `Arriq's Bedroom TV`, under iPhone Speaker. If that sheet is
empty besides the phone and the TV, the kiosk is not advertising AirPlay
2 yet (dashboard deploy does not start it).

If the name appears but tapping it never connects, two things on this
box were breaking the handshake:

1. Avahi published Smart Display on every Docker veth (`172.x` and
   `fe80::`) as well as Wi-Fi. iOS can pick an address the phone cannot
   reach. Setup now pins mDNS to the default-route interface (`wlp3s0`,
   `192.168.1.99`) and IPv4 only.
2. ufw was open on `3278:3289/udp` (a typo). AirPlay 2 needs
   `32768:60999` UDP/TCP plus 7000/tcp and nqptp 319:320/udp.

Re-run `scripts/airplay-setup.sh` (or wait for **Bluetooth Audio Setup**
after this lands on master), then close and reopen the AirPlay list so
iOS drops the cached Docker records.

## Known gaps

- **This cloud environment has no Bluetooth adapter and no speakers.**
  Doctor output and unit tests are the proof from here; the kiosk
  workflow's diagnostics step is the proof on real hardware.
- **Dummy Output after a group change** still needs a reboot.
- **HDMI fallback** is used when analog/USB/headphone are missing, so
  music might come out of the panel if that is the only real sink.
- **No Continuity / iPhone-to-Mac Handoff.** AirPlay speaker handoff is
  the Linux equivalent.
- **Multiple phones:** one A2DP stream at a time is realistic.

## Volume

`/remote` has a volume slider and mute button that call `GET`/`POST
/api/volume`, backed by `wpctl get-volume`/`set-volume`/`set-mute` on
`@DEFAULT_AUDIO_SINK@` (see `src/lib/server/audioVolume.js`). AirPlay and
Bluetooth volume from the phone still reach PipeWire directly and are
independent of this slider.

## Crackling / static on Bluetooth or the speakers

Two things fixed intermittent bursts of static:

1. SBC-XQ (`bluez5.enable-sbc-xq`) demands a higher, steadier Bluetooth
   bitrate than plain SBC. Any radio contention (AVRCP metadata polling,
   a busy 2.4GHz room) starved the stream and the underrun came out as
   static. It's now off in
   `~/.config/wireplumber/wireplumber.conf.d/51-bluez-a2dp-sink.conf`.
2. The same crackling also happened on the wired speakers, which pointed
   at PipeWire's audio graph running too close to the edge (an xrun)
   rather than anything Bluetooth-specific.
   `~/.config/pipewire/pipewire.conf.d/99-buffer-stability.conf` raises
   the minimum quantum so normal scheduling jitter doesn't underrun.
   `scripts/bt-audio-loopback.sh`'s loopback latency also went from 50ms
   to 100ms for the same reason.

Both configs are written by `scripts/bluetooth-audio-setup.sh`; re-run it
(or `scripts/speaker-audio-setup.sh`) and restart `wireplumber` /
`pipewire` / `pipewire-pulse` to pick them up. If crackling comes back,
check `pw-top` for climbing xrun counts before assuming it's Bluetooth.
