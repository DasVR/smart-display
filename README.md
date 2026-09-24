# Smart Display

A wall-mounted 1920×1080 kiosk dashboard. It shows the clock, due schoolwork,
what the local coding agents are doing, now-playing music with synced lyrics,
and live weather radar, all over a weather-reactive liquid-metal shader. You
control it from a phone at `/remote`.

It is a SvelteKit single-page app plus a small Node server. The server serves
the build, exposes `/api/*`, and relays WebSocket events between the display,
the phone remote, and host services (AirPlay, Bluetooth, Home Assistant,
Ollama, the package updater).

## Views

| View | What it shows | Data source |
| --- | --- | --- |
| **Clock** | Poster clock, day-phase kicker, sun/wind/radar chips | `/api/weather` |
| **School** | The next thing due, then a rolling seven-day timetable starting today | `/api/calendar` (Google Calendar, `#hw` events) |
| **Agents** | The active coding agent, the rest of the roster, host load and services | `/api/agents`, `/api/telemetry`, `/api/ollama/ps` |
| **Music** | Album stage, synced and aligned lyrics, playback controls | `/api/nowplaying`, `/api/lyrics` |
| **Weather** | Live radar with a nowcast, current conditions, NWS alerts | `/api/weather`, `/api/weather/station` |

On every view, the **Dynamic Island** (top-center) shows transient events:
notifications from `/api/notify`, now playing, install progress, severe
weather, and volume changes.

## Quick start

```bash
npm ci
npm run dev          # Vite dev server on :3000
```

To run a production build the same way the kiosk does:

```bash
npm run build
npm start            # node src/ws-server.js, serves build/ + /api + /ws on :3000
```

Run the tests (Node's built-in runner):

```bash
npm test
```

### Online demo (GitHub Pages)

A self-contained copy of the kiosk UI runs at
`https://<owner>.github.io/<repo>/`, with canned data and no server. A
**Demo** button in the corner switches between scenarios: music with lyrics,
StandBy, severe weather, agents, installs.

- **One-time setup:** Settings → Pages → Source: **GitHub Actions**.
- **Turn it on or off:** Actions → **Demo site (GitHub Pages)** → Run workflow
  → `enable` or `disable`. Disabling replaces the site with a "demo is off"
  page. To remove it entirely, unpublish it under Settings → Pages.
- **Keep it fresh:** set the repository variable `DEMO_PAGES=on`, and every
  push to `master` republishes the demo.
- **Build locally:** `BASE_PATH=/smart-display npm run build:demo`, which writes
  `build-demo/`.

The demo build (`STATIC_DEMO=1`) swaps the Node adapter for the static one.
`src/lib/demo/staticDemo.js` then answers `/api/*` and `/ws` in the browser.
Its data is generic: a Chicago location, invented services, and a demo track
with original lyrics. Vite swaps `src/lib/homeLocation.js` for a demo
stand-in, so the kiosk's real coordinates never reach the published bundle.
None of the demo code ends up in the kiosk build.

### Preview URLs

These query parameters show a state without needing real hardware or data:

| URL | Shows |
| --- | --- |
| `/?demo=music` | Music view with a demo track (`&t=<sec>` to seek, `&freeze=1` to pause the clock) |
| `/?demo=voices` | Music view with call-and-response lyric voices |
| `/?demo=agents` | Agents view with a demo roster |
| `/?island=install` | Island install-progress animation |
| `/?wx=warning` / `watch` / `advisory` / `hurricane` / `rain` | Severe-weather ticker and island states |
| `/?wx=notify` | A sample agent-finished notification |
| `/?standby=1` | StandBy night mode on the Clock view |

### Smart behaviours

- **Swipe** left or right anywhere on the stage (touch or mouse drag) to change
  views. The stage follows your finger with a rubber band and commits past
  18% of the width or on a quick flick.
- **Smart Stack** (`src/lib/smartStack.js`): when music starts while the
  Clock is showing, the display moves to Music, and goes back when playback
  stops. After 10 minutes with no input it drifts back to Clock. It never
  moves within 30 seconds of a touch, key press or remote command.
- **StandBy**: after 2 minutes idle on the Clock at night, the clock turns
  red and everything else fades, like an iPhone in StandBy. Any touch wakes it.
- **Liquid metal** ripples out from a tab when the view changes, and follows
  your finger while you swipe.

### Keyboard

- **← / →**: previous / next view
- **Alt+Y**: toggle GPU low-power mode (freezes the shader)

### Phone remote

Open `/remote` on a phone and use **Add to Home Screen** to run it as an app.
A floating tab bar at the bottom switches between:

- **Remote** (`/remote`): panel power, channel picker, volume
- **Night** (`/remote#night`): night schedule and proximity wake
- **Lyrics** (`/remote/lyrics`): pick the lyrics provider for the current track
- **Stats** (`/remote/stats`): AirPlay, speakers, Bluetooth, host load, services,
  updates, git

Running as a home-screen app, the pages draw under the status bar. They
pad every edge by its safe-area inset, and keep every tap target in the
lower, thumb-reachable part of the screen.

## Project layout

```
src/
  app.css                 design tokens and global primitives (see DESIGN.md)
  routes/+page.svelte     the kiosk shell: top mast, view stage, bottom trough
  routes/remote/          phone remote pages
  routes/api/             HTTP endpoints
  ws-server.js            production server: build handler, /ws relay, host watchers
  lib/components/         view and widget components
  lib/shaders/            the WebGL liquid-metal background
  lib/services/           client-side pollers (now playing, Ollama arbiter, chimes)
  lib/server/             server-only integrations (audio, display power, lyrics, updates)
scripts/                  deploy, audio/Bluetooth/AirPlay setup, lyric alignment
docs/                     setup guides and endpoint references
tests/                    node:test suites
*.service                 systemd units for the kiosk box
```

## Deploying to the kiosk

The display box runs:

- `smart-display-server.service`: `node src/ws-server.js` on port 3000
- `smart-display-kiosk.service`: `start-kiosk.sh`, which runs `cage` (a
  single-app Wayland compositor) with Chromium in `--kiosk` mode, forced to
  1920×1080

Every push to `master` triggers `.github/workflows/deploy-kiosk.yml` on a
self-hosted runner on the display box. It runs `scripts/deploy.sh`, which
resets the checkout to `origin/master`, runs `npm ci && npm run build`, and
restarts both services.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP/WebSocket port (default `3000`) |
| `DISPLAY_SCHEDULE_PATH` | Night schedule JSON (default `data/display-schedule.json`) |
| `DISPLAY_HDMI_STAMP` | File holding the panel power state (`on`/`off`) |
| `GOOGLE_TOKEN_PATH` | OAuth token for the School view's calendar |
| `HA_TOKEN_PATH` | Home Assistant token for phone wake |
| `LYRICS_DB_PATH` | SQLite lyrics cache |
| `AIRPLAY_NOWPLAYING_PATH`, `AIRPLAY_ART_PATH` | shairport-sync metadata handoff |
| `FORCED_ALIGN_*` | Lyric alignment engine settings (see `scripts/forced_align/README.md`) |

## Performance

The kiosk runs on an integrated GPU, so the rendering budget is tight:

- One WebGL context. The shader renders at a fixed 1280×720 and is scaled
  up to fill the panel. It drops to 30fps in eco mode and holds its last
  frame in low-power and sleep.
- A load governor (`src/lib/displayLoad.js`) steps quality down
  (`full → eco → frozen`) when Ollama is running or CPU/RAM are high. That
  drops the backdrop blur and ambient animations.
- Animations that loop forever touch only `transform` and `opacity`, so
  they stay on the compositor and never repaint the whole frame.
- Fonts are self-hosted (`@fontsource-variable`). The kiosk's Chromium runs
  with its disk cache off, so nothing is fetched from a CDN at boot.

## Further reading

- [`DESIGN.md`](DESIGN.md): design tokens, layout rules, motion, do's and don'ts
- [`docs/notify-endpoint.md`](docs/notify-endpoint.md): posting events to the island
- [`docs/bluetooth-setup.md`](docs/bluetooth-setup.md): Bluetooth, AirPlay and speaker setup
- [`scripts/forced_align/README.md`](scripts/forced_align/README.md): lyrics lookup, cache and alignment
- [`PROGRESS.md`](PROGRESS.md): change log
