# Smart Display Progress Log

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
