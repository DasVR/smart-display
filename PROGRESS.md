# Smart Display Progress Log

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
