# Smart Display Progress Log

## 2026-10-09: The Action button and commands for "tell the wall"

### Done
- `src/lib/wallActions.js` (pure) has three parts:
  - **Commands:** done, snooze, brief, I'm leaving, show a view, music,
    screen, and allow / deny.
  - **Fuzzy task matching:** "bins" finds "Take out the bins".
  - **The menu and the press:** a context-built menu and a smart press.
- `src/lib/server/actionHub.js` adds three routes:
  - `POST /api/action` is the smart press. A waiting approval is only read
    out, never allowed.
  - `GET /api/action/menu` returns one label per line.
  - `POST /api/action/run` runs a chosen label.
  - Every action flashes on the island as "iPhone".
- `/api/tasks/say` tries commands first and only adds a chore when it
  isn't one.
- The phone's Siri & Shortcuts page has new recipes:
  - **Wall** for the Action button: the menu, plus Tell the wall.
  - **Wall press** for Back Tap.
  - The try box now runs commands too.
- 6 new tests.

## 2026-10-09: Siri, departure board, tarnish, agent approvals, day receipt

### Done
- **Siri and the Action button** (highest priority):
  - `src/lib/quickSay.js` turns one spoken sentence into a chore or alert
    ("remind me to…", "every Monday and Thursday at 6pm", "tomorrow", "in
    20 minutes") and turns tasks back into sentences.
  - New routes: `/api/tasks/say`, `/api/tasks/brief` and
    `/api/tasks/next/done|snooze`. Add `?format=text` to get back just the
    sentence for Speak Text.
  - The phone has a **Siri & Shortcuts** page with copyable recipes and a
    "Try a phrase" box (over `/ws`).
- **Departure board** (`src/lib/departures.js`, `DepartureBoard.svelte`):
  - Triggers: any "Leave …" chore or alert turns Clock into an airport board
    for the hour before, staying until 5 minutes after.
  - Rows:
    - BRING: the departure's notes and the weather;
    - DO: chores due before you leave (tap to tick off);
    - DUE: today's homework.
  - The Smart Stack brings it forward, holds Music off while it's up, then
    restores the old view.
- **Tarnish** (`src/lib/tarnish.js` and a shader uniform):
  - Overdue chores grow patina from the bottom-left corner, more as they
    age, capped at 0.75.
  - Done chores polish it back with a sheen on the receding edge.
- **Agent approvals:**
  - Model: `src/lib/approvals.js`. Server: `approvalHub.js`, at
    `/api/approvals` with long-poll `?wait=1`.
  - Kiosk card and a phone dock on every remote page, so the first tap
    answers.
  - `hooks/display-approve.mjs` is a Claude Code PermissionRequest hook. It
    stays silent on timeout or when the display is unreachable, so the
    terminal asks as usual.
- **End-of-day receipt:**
  - `src/lib/dayLog.js` and `dayLogHub.js` tally chores, alerts, songs,
    agent runs and approvals into `data/daylog.json` (a week, batched saves,
    flushed on SIGTERM).
  - `/api/day` builds the receipt. The kiosk prints it the first time
    StandBy comes on each night.
- **Pages demo:** new scenarios for Agent needs you, Departure board,
  Overdue chores and Day receipt.
- **Tests:** 25 new across 6 files, passing in several time zones.

## 2026-10-09: Chores, jobs and alerts, open to other platforms

### Done
- `src/lib/tasks.js` (pure, 12 tests in four time zones) models the list:
  - **Kinds:** chores stay until done; alerts fire and move on.
  - **Repeats:** one-off, hourly, daily, weekly on chosen days, every N weeks,
    monthly (the 31st clamps to shorter months). Times hold their wall-clock
    hour across DST.
  - **Done early:** doing a chore early uses up the current occurrence.
  - **Snoozes:** an item comes back once the snooze ends.
  - **Firing:** one island ping per occurrence.
- `src/lib/server/taskHub.js` + `taskService.js` handle storage and access:
  - The list is stored in `data/tasks.json` (atomic writes).
  - The REST API is at `/api/tasks`. It's optionally locked by a bearer token
    (`npm run api-token`), with no restart needed either way.
  - The scheduler ticks every 15 s.
  - Webhooks post to subscribers, HMAC-signed when a secret is set.
  - The kiosk and remote go over `/ws`.
- `scripts/tasks-mcp.mjs` is a dependency-free MCP stdio bridge with seven
  tools, tested end to end.
- **Kiosk:** a Today panel on the Clock view (tap to complete), and a bell
  glyph on the island for chores and alerts.
- **Phone:** a new Tasks tab with a thumb-reach + button, a bottom sheet,
  tap-to-complete, and snooze and delete.
- **Pages demo:** seeded with sample chores, and fully interactive.
- **Bugs caught while building:**
  - A weekly rule that starts on an off day now first comes due on its
    next listed day.
  - The phone's sheet collided with the global `.sheet` pane class; it's
    renamed `.add-sheet`.

## 2026-09-24: Screen-by-screen UI fixes

### Done
- **Kiosk stage height.** The bottom band (tick row, a 6rem trough holding one
  line, padding, and the floor clearance) took about 30% of the panel, which
  clipped School and Music.
  - The trough is now 4.25rem, and the padding around it shrank.
  - The floor clearance itself is unchanged.
  - No view has a page title any more; it's a screen-reader-only `h1` instead.
- **School.**
  - A "Next up" line replaces the list that duplicated the timetable.
  - The timetable is now a rolling seven days from today. The old
    Sunday-to-Saturday week dropped anything due after Saturday.
  - An empty today column reads "Nothing due today".
- **Music.** The album art is no longer cropped at the top.
- **Kiosk scrollbars.** Hidden in every build, to match the kiosk's
  `--hide-scrollbars`.
- **Music rebuilt as a record deck** (inspired by the vinyl crate on the
  spacehey-personal profile):
  - The record slides out of the sleeve and spins while playing, and tucks
    back when paused. It holds still in eco and frozen modes.
  - Session history leans away like sleeves in a crate.
  - A kicker line shows live bars, the source and a session counter
    (`artSessionPosition()`, tested).
  - The scrub bar fits on one row, and a progress ring runs round the play
    button.
  - The empty state is an empty sleeve.
  - The lyrics engine is untouched.
- **Remote.**
  - Raw process errors ("spawn wpctl ENOENT") become a plain message.
  - The power label says what a tap does, since "Panel on" is already shown
    at the top.
  - Tab links respect the base path, so they also work on the Pages demo.
- **Docs.** DESIGN.md (trough, stage height, timetable) and the README School
  row are updated. The notify and Bluetooth guides were checked against the
  server routes and are accurate.

## 2026-09-23: Phone remote for one-handed, home-screen use

### Done
- **Fixed the unreachable top row.** Saved to an iPhone home screen, the remote
  runs under the status bar (`viewport-fit=cover` + `black-translucent`). The
  pages used a flat 16px top padding, so the Lyrics/Stats links, and the only
  way back from those pages, sat under the Dynamic Island. All three pages now
  pad every edge by `env(safe-area-inset-*)`.
- **Floating liquid-glass tab bar** (`RemoteTabBar.svelte`): Remote · Night ·
  Lyrics · Stats, above the home indicator, with an iOS-style scroll-edge fade.
- **Two panes on the Remote screen.** The everyday controls (power, channel,
  volume) sit low, in thumb reach. The night schedule and proximity settings
  moved to the Night tab (`/remote#night`).
- Press feedback is `scale(0.96)` everywhere, matching the kiosk.
- Checked on an emulated iPhone with 59px/34px safe-area insets: the header
  clears the island, and every tap target on Stats and Lyrics is in the tab bar.

## 2026-09-23: GitHub Pages demo

### Done
- `npm run build:demo` builds a static copy of the kiosk UI. In the browser,
  `src/lib/demo/staticDemo.js` stands in for the server: `/api/*` returns canned
  JSON, and a fake `/ws` sends `init` frames, echoes navigation and streams a
  spectrum. Weather is generated around the current time, with live RainViewer
  radar over Chicago.
- A Demo button (`src/lib/demo/DemoPanel.svelte`) picks between the existing
  preview states.
- `.github/workflows/demo-pages.yml` enables or disables the site from the
  Actions tab. With `DEMO_PAGES=on`, it also republishes on every push.
- **Privacy:**
  - The home coordinates moved to `src/lib/homeLocation.js`, which the demo
    build swaps for a stand-in.
  - The radar's aria-label no longer spells out the street address.
  - The demo track uses original lyrics.
- The kiosk build contains none of the demo code (checked).

## 2026-09-23: iOS-style features and fluidity

### Done
- **Liquid-glass tab lens.** The active-tab indicator is a small refractive
  glass lens. Its leading and trailing edges move on different clocks, so it
  stretches toward the new tab and settles, like the iOS 26 tab bar. It thins
  while moving and squeezes on press.
- **Direction-aware page transitions.** The new view slides in from the side
  you moved toward, sharpening out of a light blur.
- **Swipe between views** with touch or mouse, with a rubber band and flick
  detection. Vertical drags still scroll.
- **Smart Stack** (`src/lib/smartStack.js`, with tests): jumps to Music when
  playback starts on the Clock and returns when it stops. After 10 minutes idle
  it goes back to Clock. It never moves within 30 seconds of human input, and
  its own navigate echo from the server isn't counted as input.
- **StandBy night mode.** An idle Clock after dark turns red and quiet.
  Preview it with `?standby=1`.
- **Liquid metal:** ripples from the chosen tab on every view change, and taps
  stir it too (touch never fires `pointermove`).
- **Fixes in the shader:**
  - Easing is now frame-rate independent, so eco mode (30fps) no longer eases
    at half speed.
  - Wind direction eases along the shortest arc instead of swinging through
    180 degrees.
- Removed the unused SVG goo filter from the page.

## 2026-09-23: UI review, redesign and optimization pass

### Done
- **Top mast no longer collides with the Dynamic Island.** The header row is now a
  `nav | island slot | status` grid. The date and weather stack on two lines on the right.
  At 1920px the tabs end at 663px and the status starts at 1428px, both clear of the
  resting island (726–1195px). Below 1600px the island gets its own band.
- **The island stops cutting off titles.** The pill width was rounded down from a
  fractional ghost measurement, so "Package updates" showed as "Package updat…".
  It now rounds up.
- **Clock view no longer repeats the trough.** The Sun/Wind/Radar chips sat under the
  clock and again in the trough; the trough drops them on Clock. The trough row is
  vertically centered, and the waveform grows from its midline.
- **GPU and paint savings:**
  - The sheet sheen animated `background-position` through an SVG displacement
    filter (a full-pane repaint every frame). It now animates `transform` only.
  - Removed the 70px `filter: blur` on the sheet glow, which is already a soft
    radial gradient.
  - The morning glow animated `box-shadow` on the whole root; it now fades a
    pseudo-element's opacity.
  - The sheen stops in eco, frozen and sleep.
- **Self-hosted fonts.** Plus Jakarta Sans and Fira Code now come from
  `@fontsource-variable`; the Google Fonts links are gone. The kiosk's Chromium runs
  with its disk cache off, so it re-downloaded fonts every boot and fell back to
  system fonts when offline. Dropped JetBrains Mono, which was loaded but never used.
- Tabs use named transition properties and press at `scale(0.96)`.
- School empty state no longer repeats itself ("Clear this week" plus "Nothing due").
- `/remote/stats` shows the git branch in mono, clamped to two lines, instead of
  breaking it mid-word. Removed a dead `.value.ok` selector (the build is warning-free).
- **Docs:** added `README.md` (setup, views, preview URLs, deploy, env vars) and
  `DESIGN.md` (tokens and rules in the DESIGN.md spec format).

## 2026-08-30 — Cybernetic command center

### Done
- Snapped Bayer dither to a 4px virtual pixel grid in the liquid-metal shader so gradients read as chunky halftone instead of fine grain.
- Replaced the Dev Wall git footer with an Active Agents + tool-execution monitor. Orbs, Reasoning, and ToolCall cards map live Ollama / git / telemetry signals (no invented traces).
- Bracket meters for CPU, RAM, and Tailscale. ASCII corner marks, Braille spinners, and bitstreams on live tasks.
- Unified clock, weather, and status pill into one top mast cluster. Glass tokens on the host slab and ambient trough only.

## 2026-08-29 — UI scale + live data pass

### Done
- Scaled CSS tokens for distance viewing: larger radius, bigger skeletons, larger shared view shell.
- Rewrote `DevView.svelte` with bigger status pills, bigger stat values, live telemetry polling every 5s.
- Rewrote `SchoolView.svelte` to pull from `/api/calendar` (Google Calendar) instead of mock events, bigger rows and badges.
- Rewrote `MusicView.svelte` to pull from `/api/nowplaying` via playerctl, bigger album art and controls, vinyl spin when playing.
- Updated `ws-server.js` with real endpoints:
  - `/api/telemetry` — real RAM/CPU, live health checks for dasdev.net, HA, display, real Docker container count.
  - `/api/calendar?days=N` — reads `~/.hermes/google_token.json`, fetches Google Calendar events.
  - `/api/nowplaying` — uses `playerctl` to get active media player metadata and position.
- Fixed z-index layering: island sits above vignette, noise overlay above content but below island.
- Added boot-time gooey Dynamic Island demo so the blob is visible.
- GlassPanel rim now has animated lavender-white shimmer + chromatic aberration line.

### Active display state
- `smart-display-server`: active
- `smart-display-kiosk`: active
- Display output: HDMI-A-1 forced to 1920x1080 via wlr-randr.

### Next up (while user is away)
- Test calendar/nowplaying with real data.
- Wire HA companion app / automations for view switching.
- Add Canvas API for assignments if credentials available.
