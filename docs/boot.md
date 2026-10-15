# Turning on

From power on to the dashboard, the screen shows one thing: a small standby
light breathing in the middle of a black screen. When the wall is ready, it
opens its eyes. The light brightens and draws out into a thin seam, the black
parts like eyelids, and the dashboard settles into place underneath while the
clock spins up to the time. That takes about a second.

## What draws the light

Three different programs draw the light during a boot. They all draw it the
same size, in the same place and breathing at the same pace, so the hand-offs
between them don't show.

| From | What's on screen | Drawn by |
| --- | --- | --- |
| the kernel starting | the boot splash | `scripts/boot/plymouth` (a Plymouth theme; `make-light.py` draws its image from the browser's own pixels) |
| cage and the browser starting | the boot page, opened from disk, so it needs no server | `static/boot.html` |
| the server answering | the wall's page, with the light in its first bytes of HTML | `src/app.html` |
| ready (fonts, first weather, a painted frame; 2.5 s at most) | the eyes open | `src/lib/wake.js` |

The boot page waits for the server itself, so the browser never shows an
error page. If the server takes over 15 seconds, it says "Starting the wall…"
quietly, and after a minute it says why it might be slow. The wall's page
gives up the cover by itself after 12 seconds if a script failed, so a broken
build can't hide the wall.

With reduced motion, the eyes opening is a quarter-second fade.

## Why it was slow, and what changed

- **The text console.** Nothing hid the kernel's messages or the login
  prompt. Now: `quiet splash`, no boot menu, no cursor, and the kiosk takes
  over the console from the login prompt (other consoles still work, with
  Ctrl+Alt+F2).
- **Waiting for the network.** The server and the kiosk both waited for
  `network-online.target`, which can hold a boot up for 30 seconds or more.
  Neither needs it. The server answers on localhost at once and fetches when
  the network arrives.
- **Two mode changes.** cage started the screen in the TV's preferred mode,
  then `wlr-randr` switched it to 1080p a second later. Each switch makes a
  TV re-sync for a second or two. Now the kernel starts in 1080p
  (`video=HDMI-A-1:1920x1080@60`), and the kiosk switches only if the mode is
  wrong.
- **An empty first frame.** The weather wasn't kept across restarts, so the
  wall came up with `--` and filled in, changing colour, as the network woke
  up. Now the last good forecast is kept (`data/weather-last.json`), and the
  first frame is the one from before, refreshed a few seconds later.
- **The browser.** It no longer waits on the keyring (`--password-store=basic`)
  and doesn't check for components, sync or extensions. Ubuntu's
  `chromium-browser` is a snap, which takes several seconds to start cold. The
  kiosk prefers Google Chrome or a regular Chromium package when one is
  installed (`KIOSK_BROWSER` picks one by hand).
- **Boot noise.** The wall no longer greets you with "Music problem" while the
  media players start (music faults wait 30 seconds after the page loads), or
  with "Normal mode" (the eyes opening already says so).
- **Deploys.** A merge used to restart cage and Chromium, so the wall went
  black. Now `scripts/deploy.sh` loads the new build in the running browser
  through its DevTools port (`scripts/kiosk-reload.mjs`), and the wall wakes
  up in place. It still restarts the kiosk fully when `start-kiosk.sh` changed
  or the browser doesn't answer.

## Setting it up on the wall

Deploys bring the new page, boot screen and kiosk script. The boot splash,
the kernel settings and the new service files need root, so run this once on
the wall:

```bash
sudo scripts/boot/setup-quiet-boot.sh --dry-run   # look first
sudo scripts/boot/setup-quiet-boot.sh             # then reboot
```

It edits GRUB (or a Raspberry Pi's `cmdline.txt`), installs Plymouth and the
theme, and rebuilds the initramfs (about half a minute). It also installs this
repo's server and kiosk units. If the screen isn't `HDMI-A-1` at 1920×1080, pass
`--output` and `--mode`. Everything it replaces is kept as
`*.smart-display.bak`, and `--undo` puts it all back. `--no-splash` skips the
splash.

## How long it took

The wall times each boot itself. The boot page, the server and the wall's page
each note when they got there:

```bash
npm run boot-report            # on the wall (or: npm run boot-report -- http://wall:3000)
```

```
Last boot:
      0 ms  Power on (kernel starts)
     6.2 s  Server process starts
     7.4 s  Browser shows the boot screen
     7.9 s  Server answering
     8.0 s  Boot screen reaches the server
     8.1 s  Wall page starts loading
     9.0 s  Wall awake
  Total: 9.0 s (from power on)
```

(The numbers above are an example.) It marks the slowest step, then shows
systemd's view of the same boot: the total, what the kiosk waited for
(`critical-chain`) and the slowest services. `GET /api/boot` has the last ten
(`data/boot-times.json`). Power on means the kernel starting. The firmware's
own time before that (the BIOS logo) isn't counted.

## Files

- `static/boot.html`: the browser's boot page
- `src/app.html`: the light in the wall's page, before any script
- `src/lib/wake.js`: the eyes opening, and `awake`, which the clock's spin-up
  waits for (`RollingDigit.svelte`)
- `src/lib/bootTimeline.js`, `src/lib/server/bootLog.js`, `scripts/boot/report.mjs`: the timings
- `src/lib/server/weatherCache.js`: the last good forecast
- `scripts/boot/`: `setup-quiet-boot.sh`, the Plymouth theme and `make-light.py`
- `start-kiosk.sh`, `smart-display-kiosk.service`, `smart-display-server.service`
- `scripts/kiosk-reload.mjs`: deploys without a restart

If you change the light's look, change it in `static/boot.html`, `src/app.html`
and the Plymouth script together. If the CSS glow changes, re-measure the
`PROFILE` in `make-light.py`.
