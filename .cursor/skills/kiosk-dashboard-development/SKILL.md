---
name: kiosk-dashboard-development
description: Build GPU-light kiosk dashboards with SvelteKit + WebGL.
category: software-development
---

# Kiosk Dashboard Development

## When to use

Building animated dashboards that boot directly to a display (no desktop) — smart home dashboards, info displays, media art installations, room nervous systems. The target is a Linux box + HDMI display running `cage` Wayland compositor + Chromium `--kiosk` pointing at a local SvelteKit SPA.

## Core Stack

| Layer | Technology | Why |
|---|---|---|
| Compositor | `cage` (tiny Wayland compositor) | Boots to single app, no desktop bloat |
| Browser | Chromium `--kiosk --ozone-platform=wayland` | Renders the dashboard fullscreen |
| Resolution | `wlr-randr --output HDMI-A-1 --mode 1920x1080` | Forces readable output on 4K panels |
| Framework | SvelteKit + `@sveltejs/adapter-node` | SSR disabled (`export const ssr = false`) for client-only SPA |
| Server | Custom Node.js HTTP + WebSocket | Serves build, handles `/api/*` endpoints, `/ws` relay |
**Background** — Raw WebGL fragment shader | Single full-screen quad, no React wrappers
**Glass** — CSS `backdrop-filter: blur()` + SVG `feGaussianBlur` | GPU-free refraction/metaballs
**Liquid Metal** — Single-pass GLSL with domain-warped FBM + Fresnel/Specular + SDF-driven true Liquid Glass (refraction + edge chromatic aberration) | iGPU-safe, 60fps
**Data** — Real endpoints polling local APIs | Telemetry, calendar, now-playing, HA webhooks
**Remote** — Phone browser as WebSocket controller | Swipe/navigate events to `/ws`
**Deploy** — Self-hosted GitHub Actions runner auto-rebuilds + restarts kiosk on push

## Kiosk Systemd Units

Two units: one for the Node server, one for cage+Chromium.

### `smart-display-server.service`

```ini
[Unit]
Description=Smart Display Dashboard Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /path/to/build/index.js
WorkingDirectory=/path/to/project
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

### `smart-display-kiosk.service`

Uses a wrapper script to set Wayland env vars and force resolution:

```ini
[Unit]
Description=Smart Display Kiosk
After=smart-display-server.service

[Service]
Type=simple
User=displayuser
ExecStartPre=/usr/bin/mkdir -p /run/user/1000
Environment="XDG_RUNTIME_DIR=/run/user/1000"
Environment="WAYLAND_DISPLAY=wayland-1"
ExecStart=/path/to/start-kiosk.sh
Restart=always

[Install]
WantedBy=graphical.target
```

### `start-kiosk.sh`

```bash
#!/bin/bash
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1

# Force 1920x1080 output (critical for 4K panels, prevents top-left-quadrant bug)
wlr-randr --output HDMI-A-1 --mode 1920x1080

chromium-browser \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --kiosk \
  --app=http://localhost:3000 \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-features=TranslateUI \
  --incognito
```

**Permissions:** User must be in `video`, `input`, `render` groups. `seatd` service must be enabled.

## WebGL Shader — GPU-Light Rules

On weak iGPU, every fragment matters. Follow these rules:

1. **Half-resolution render** — lock canvas to 1280×720, use CSS `image-rendering: pixelated` to upscale. Cuts fill-rate by ~75%.
2. **Single-pass GLSL** — combine fluid motion + dither + grid in one fragment shader. No multi-pass post-processing.
3. **Bayer dither in fragment** — 4×4 or 8×8 matrix baked as `const mat4` or inline `float` checks. Avoid texture lookups.
4. **Cap DPR** — `const dpr = Math.min(window.devicePixelRatio || 1, 1.5);` never use native DPR on 4K.
5. **`powerPreference: 'low-power'`** — request low-power GPU context.
6. **No CRT** — no scanlines, curvature, heavy bloom. Keep modern and clean.
7. **DOM→GL sync** — collect `.glass-panel`/`.panel` rects live via `getBoundingClientRect()`, pass to shader as `vec4` uniform array. MutationObserver on `.display-root` updates panel data when view changes.

## Liquid Glass Shader via SDF (True iOS Effect)

Standard CSS `backdrop-filter` only blurs; it doesn't bend light. True Liquid Glass uses **Signed Distance Fields (SDFs)** inside the single-pass fragment shader:

**SDF rounded-rect:** mathematically define panel geometry from the DOM. The shader computes distance of every pixel to the panel edge.

**Inside the glass:** when SDF returns negative, apply a **magnification refraction** — warp the liquid metal UV by pulling the sample toward the panel center. This bends the background behind the glass, not just blurring it.

**Edge-only chromatic aberration:** near the SDF border, sample R/G/B at tiny radial offsets. The glass center stays crystal clear; the rim shimmers with color fringing.

### Key shader functions (GLSL ES 1.0)

```glsl
float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// normals from finite differences (cheap, no tex lookups)
vec3 fieldNormal(vec2 uv, float t, float bass) {
    float e = 4.0 / u_resolution.y;
    float h = fluid(uv, t, bass);
    float hx = fluid(uv + vec2(e, 0.0), t, bass);
    float hy = fluid(uv + vec2(0.0, e), t, bass);
    vec3 n = normalize(vec3(h - hx, h - hy, 0.6));
    return normalize(vec3(n.x, n.y, 1.0));
}
```

**Performance:** all in one shader pass. No DOM→WebGL framebuffer capture. No multi-pass post-processing. Keeps 60fps on iGPU.

**iGPU caps:** `powerPreference: 'low-power'`, cap DPR at 1.5, half-res canvas + CSS `image-rendering: pixelated` if needed.

### Bayer 8×8 inline (GLSL ES 1.0 compatible)

```glsl
float bayer8(vec2 uv, float scale) {
  vec2 p = floor(mod(uv * scale, 8.0));
  // ... inline all 64 cases as if-else chain
  return b / 64.0;
}
```

### Matrix grid overlay

```glsl
float grid(vec2 uv, float t) {
  vec2 g = fract(uv * 40.0);
  float line = smoothstep(0.0, 0.02, g.x) * smoothstep(0.0, 0.02, g.y);
  float fall = 0.5 + 0.5 * sin(t * 0.3 + uv.x * 3.0 + uv.y * 2.0);
  return (1.0 - line) * 0.04 * fall;
}
```

## Self-Hosted GitHub Actions Deploy Hook (Auto-Rebuild on Push)

When the display is Tailscale-only (no public DNS), a hosted GitHub Actions runner cannot reach it. Use a **self-hosted runner** on the kiosk box instead — it polls GitHub outbound, needs zero inbound ports.

**Setup (one-time):**
```bash
mkdir -p /home/das/actions-runner && cd /home/das/actions-runner
curl -sL -o runner.tar.gz https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz
tar xzf runner.tar.gz
gh api -X POST repos/OWNER/REPO/actions/runners/registration-token
./config.sh --url https://github.com/OWNER/REPO --token TOKEN --name das-server \
  --labels kiosk,linux,self-hosted --unattended --replace
```

**Run as a user systemd service** (not root — needs to restart `smart-display-server` / `smart-display-kiosk`):
```ini
# ~/.config/systemd/user/actions-runner.service
[Unit]
Description=GitHub Actions Runner (kiosk deploy)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/das/actions-runner
ExecStart=/home/das/actions-runner/run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```
```bash
systemctl --user enable actions-runner
systemctl --user start actions-runner
```

**Workflow** (`.github/workflows/deploy-kiosk.yml`):
```yaml
name: Deploy + Reboot Display
on:
  push:
    branches: [master]
  workflow_dispatch:
jobs:
  deploy-kiosk:
    runs-on: [self-hosted, linux, x64, kiosk]
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy.sh
```

**Deploy script** (`scripts/deploy.sh`):
```bash
#!/bin/bash
set -euo pipefail
cd /home/das/projects/smart-display
npm ci --no-audit --no-fund
npm run build
sudo systemctl restart smart-display-server
sudo systemctl restart smart-display-kiosk
```

**Kiosk chromium cache:** always pass `--incognito --disk-cache-dir=/dev/null --user-data-dir=/tmp/chromium-kiosk-cache` in the kiosk launcher so the new build loads immediately after restart.

## Ollama Inference Arbiter (Dynamic GPU Hand-Off)

When local LLM inference runs, the dashboard must yield GPU cycles:

**Backend** — poll `http://localhost:11434/api/ps` every 500ms:
- `models.length > 0` → broadcast `LOW_POWER` to all WS clients
- `models.length === 0` → broadcast `HIGH_PERFORMANCE`

**Frontend** — the shader component listens for CustomEvent:
```js
window.addEventListener('power-state', (e) => {
  setLowPower(e.detail === 'LOW_POWER');
});
```

When `LOW_POWER`, the `render()` loop returns early without calling `gl.drawArrays()`, freezing the frame.

**Pitfall — Arbiter code injection broke the server.** A sibling subagent injected the Ollama polling logic into the middle of the Node.js server file, duplicating the `broadcast()` function without closing braces, and leaving a dangling `);}` where the original function was. This produced a syntax error (`Unexpected token ')'`) that crashed the server on startup. **Always verify Node files with `node --check` after any automated edit, especially when multiple agents touch the same file.** The fix: remove the broken duplicate, keep the arbiter logic, and restore the original `broadcast()` with proper braces.

## CSS Glass Panels (No GPU)

```css
.glass-panel {
  background: rgba(20, 20, 30, 0.42);
  backdrop-filter: blur(26px) saturate(1.55);
  -webkit-backdrop-filter: blur(26px) saturate(1.55);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 20px;
}
```

**Animated rim** — `::before` pseudo-element with `mask-composite: exclude` and animated `background-position`:
```css
.glass-panel::before {
  content: '';
  position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: linear-gradient(135deg, rgba(255,255,255,0.45), rgba(169,177,240,0.25) 35%, ...);
  background-size: 200% 200%;
  animation: glass-shimmer 8s ease infinite;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
```

## Gooey Notification (SVG Metaballs)

Pure SVG `feGaussianBlur` + `feColorMatrix` filter. No GPU cost.

```svg
<filter id="goo">
  <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur"/>
  <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo"/>
</filter>
```

## Data Endpoints Pattern

| Endpoint | Source | Polling |
|---|---|---|
| `/api/telemetry` | `os.totalmem()`, `os.loadavg()`, `docker ps`, live HTTP health checks | 5s |
| `/api/calendar?days=N` | Google Calendar API via `~/.hermes/google_token.json` | 5min |
| `/api/nowplaying` | `playerctl metadata` + `mpris:length` | 3s |
| `/webhook/ha` | Home Assistant automation POST | Event-driven |

## Phone Remote Pattern

- Plain HTML page at `/remote` with `ssr = false`
- WebSocket to `/ws`, sends `{type: 'swipe', dir: 'left'}`
- Server broadcasts `{type: 'navigate', view: 'dev'}` to all clients
- Display component switches view on WS message

## Power Management (Scheduled On/Off)

Use `wlr-randr` directly for display power, not X11:
```bash
WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR=/run/user/1000 wlr-randr --output HDMI-A-1 --off
WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR=/run/user/1000 wlr-randr --output HDMI-A-1 --on
```

Schedule via systemd timer or cron, NOT `xset` or `xrandr`.

## Common Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Only top-left quadrant shows | 4K panel at native res, CSS assumes 1080p | Force `--mode 1920x1080` via `wlr-randr` |
| Chromium cache shows old build | Kiosk mode caches aggressively | `--incognito` or clear `~/.cache/chromium` |
| WS handlers don't fire on mobile | SSR strips `onclick` into empty stubs | Add `export const ssr = false` to route |
| Glass panels invisible | `z-index` stacking inside `position: relative` parent | Move panels outside transitioning containers, use `position: fixed` with explicit `z-index` |
| Shader invisible | `opacity: 0.05` or wrong `mix-blend-mode` | Use `screen` blend at `opacity: 0.18-0.22` |
| iGPU chokes at 4K | Native resolution + default DPR = 8M pixels | Half-res canvas + `image-rendering: pixelated` |

## References

- `references/kiosk-systemd-units.md` — full service file templates
- `references/webgl-shader-template.glsl` — starter fluid+dither+grid fragment shader
- `references/ollama-arbiter-backend.js` — Node.js WS polling snippet
- `references/liquid-metal-sdf-shader.glsl` — complete liquid metal + SDF liquid glass shader (fresnel, specular, refraction, chromatic aberration)
- `scripts/deploy-kiosk.sh` — self-hosted runner deploy script (npm ci → build → restart kiosk)
