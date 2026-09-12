# Bluetooth speaker + auto now-playing setup

Lets a phone pair with the kiosk host over Bluetooth, stream audio to it
like a normal speaker (through whatever's plugged into the headphone
jack), and have the dashboard automatically jump to the Music view and
show what's playing — title, artist, album art, and time-synced lyrics
when available.

This was originally written from a sandboxed dev container with no
Bluetooth adapter and nothing to test against. It has since been run for
real on the kiosk host (via the `bluetooth-setup` GitHub Actions workflow,
on the self-hosted runner) and two real bugs turned up and were fixed:
the audio-sink role config was in a `.lua` format WirePlumber 0.5 no
longer reads at all (silently ignored, replaced with the current `.conf`
format), and the host user wasn't in the `audio` group so PipeWire
couldn't open any real sound card regardless of Bluetooth config (fixed
by the script, but needs a fresh login/reboot to take effect — see
below). Bluetooth pairing, the systemd services, and the class/timeout
config are confirmed working on real hardware; actual phone-to-speaker
audio still needs your own verification pass once the group change is
live.

## How the pieces fit together

1. **Pairing** — `scripts/bt-auto-agent.py` registers a `NoInputNoOutput`
   BlueZ agent that accepts every pairing request without a PIN prompt
   (there's no screen to show one on). Runs as
   `smart-display-bt-agent.service`.
2. **Audio** — PipeWire's `bluez5` module is configured for the
   `a2dp_sink` role, which makes this box *receive* A2DP audio (i.e. act
   as headphones/a speaker) rather than send it. Whatever the phone
   plays should come out of this box's **default** audio sink.
3. **Track metadata** — `mpris-proxy` (from the `bluez-tools` package)
   bridges BlueZ's native `MediaPlayer1` D-Bus interface (populated via
   AVRCP once a phone connects) to a standard MPRIS player. The
   dashboard's `getNowPlaying()` already just runs `playerctl`, which
   reads whatever MPRIS player is active — **no app code needed to
   change for this to work**, once `mpris-proxy` is running.
4. **Auto-switch to Music** — `scripts/bt-connect-watch.py` watches
   BlueZ over D-Bus for a device's `Connected` property flipping to
   `true`, then `POST`s `/api/bt/connected`, which the dashboard server
   (`ws-server.js`) turns into a `navigate` broadcast to switch every
   connected screen/remote to the Music view.
5. **Lyrics + album art** — already handled server-side: whatever
   `playerctl` reports (title, artist, `mpris:artUrl`) is looked up
   against [lrclib.net](https://lrclib.net) (free, no account) for
   time-synced lyrics. This works for anything MPRIS can see — Apple
   Music, Spotify, or a phone streaming over Bluetooth — not just one
   app.

## Setup

```bash
cd /home/das/projects/smart-display
./scripts/bluetooth-audio-setup.sh
```

This installs `bluez`, `bluez-tools`, and the D-Bus Python bindings, adds
the current user to the `audio` group if it isn't already a member,
configures BlueZ's device class + timeouts, writes the PipeWire
`a2dp_sink` config, installs and enables the three systemd services
above, and leaves the adapter powered on and discoverable.

**If it just added you to the `audio` group, reboot (or fully log out and
back in) before testing audio.** Group membership only applies to new
sessions — PipeWire's already-running session won't pick it up on its
own, and until it does, `wpctl status` will keep showing only a "Dummy
Output" sink no matter how correct everything else is.

## Verifying it actually works

Pair your phone with the display from its Bluetooth settings. It should
show up as a speaker and pair without asking for a code.

```bash
# is BlueZ + PipeWire seeing the connection?
bluetoothctl info <phone's MAC>       # Connected: yes

# is audio actually routed to the jack?
wpctl status                          # find the analog output's ID
wpctl set-default <ID>                # if it isn't already the default

# is track metadata flowing?
playerctl status                      # Playing
playerctl metadata                    # title/artist/album from the phone

# did the dashboard switch to Music on connect?
curl -X POST http://localhost:3000/api/bt/connected   # trigger it manually to test
```

If `playerctl metadata` is empty while a track is playing on the phone,
check `mpris-proxy` first — it's the one bridge that has no fallback:

```bash
systemctl --user status mpris-proxy   # or smart-display-mpris-proxy
```

If the phone never pairs cleanly (asks for a code, times out, or shows
up but won't connect for audio specifically), check:

```bash
sudo systemctl status smart-display-bt-agent
sudo journalctl -u smart-display-bt-agent -f    # while attempting to pair
```

## Known gaps

- **Audio routing isn't auto-detected.** The setup script can't know
  which PipeWire sink is your headphone jack — you set that once with
  `wpctl set-default`.
- **No volume/mute control from the dashboard.** The existing
  prev/play-pause/next controls (`/api/player/*`) already work over
  MPRIS once a phone is connected, since they go through `playerctl`
  too — but there's no volume slider in the UI yet.
- **Multiple phones**: BlueZ will happily pair several, but only one
  A2DP audio connection is realistic at a time on typical hardware;
  behavior with two phones connected simultaneously wasn't considered.
