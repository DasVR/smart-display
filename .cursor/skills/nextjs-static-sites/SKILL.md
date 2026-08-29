---
name: nextjs-static-sites
category: software-development
description: Scaffold, build, and deploy Next.js 14 static-export sites with Tailwind CSS, shadcn/ui, and Framer Motion. Optimized for dark-themed portfolios and landing pages.
---

## When to use
- Building portfolio websites, landing pages, or brochure sites
- User wants dark theme, editorial aesthetic, or motion-heavy static sites
- Deploying to self-hosted Docker + Caddy stack

## Quick Scaffold

```bash
# 1. Create project
npx create-next-app@14 <name> --typescript --tailwind --eslint --app --src-dir --no-import-alias

# 2. Init shadcn/ui (zinc base works best for dark themes)
cd <name>
npx shadcn@latest init -d

# 3. Animation + icons
npm install framer-motion lucide-react

# 4. Static export config
cat > next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = { output: 'export', distDir: 'dist' }
module.exports = nextConfig
EOF
```

## Dark Theme Globals CSS

Set `zinc` base during shadcn init, then override in `globals.css`:

```css
@layer base {
  :root {
    --background: 0 0% 4%;
    --foreground: 0 0% 98%;
    --card: 0 0% 6%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 6%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 4%;
    --secondary: 0 0% 12%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 12%;
    --muted-foreground: 0 0% 60%;
    --accent: 0 0% 12%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 15%;
    --input: 0 0% 15%;
    --ring: 0 0% 80%;
    --radius: 0.5rem;
  }
  body {
    @apply bg-[#0a0a0a] text-white antialiased;
  }
}
```

## Deployment Options

### Option A: Docker + Nginx (Tailscale / LAN)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri.html $uri/ /index.html; }
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

### Option B: Docker + Caddy Reverse Proxy (Public Domain)

When the user already runs a Caddy reverse proxy in a Docker compose stack:

1. Build the image: `docker build -t <image-name> .`
2. Run container on the existing `proxy` Docker network:
   ```bash
   docker run -d --name <container-name> --network proxy <image-name>
   ```
3. Find the container IP: `docker inspect <container-name> --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`
4. Add to Caddyfile (on host, mounted into caddy container):
   ```
   @main host dasdev.net www.dasdev.net
   handle @main {
       reverse_proxy <container-name>:80
   }
   ```
5. Restart caddy: `docker restart caddy`
6. Verify: `curl -s -H "Host: dasdev.net" http://localhost/`

**Pitfall**: The Caddyfile is volume-mounted from host. Updating the host file is NOT enough — restart the caddy container to re-read the mount.

**Pitfall**: Docker network names may differ from the compose project name. Check `docker network ls` — the network is often just `proxy`, not `<project>_proxy`.

**Pitfall**: If a previous container with the same name exists, `docker run` fails. Always `docker rm -f <name>` before recreating.

**Pitfall**: Root domain AAAA records bypass Cloudflare Tunnel — If the root domain (`@`) has an AAAA record pointing to the server's IPv6, Cloudflare connects DIRECTLY instead of through the tunnel. Residential ISPs block inbound 80/443, causing Error 522. Fix: delete AAAA record and add CNAME from `@` to `<tunnel-uuid>.cfargotunnel.com` (or use `www` subdomain).

### Option C: GitHub Actions Auto-Deploy via Cloudflare Tunnel Webhook

For CI/CD where `git push` auto-deploys the site.

**Architecture:**
```
GitHub Actions (on push) 
    → POST to https://webhook.dasdev.net/deploy 
    → Cloudflare Tunnel routes to server port 9002
    → Webhook server verifies HMAC-SHA256 signature → runs deploy.sh
    → deploy.sh: git pull → npm build → docker rebuild → caddy reload
```

**Why HMAC-signed webhooks instead of bearer tokens:**
The old approach used a static `X-Deploy-Token` header. A captured header could be replayed against the same endpoint. With HMAC-SHA256, the signature is computed over the request body (including timestamp + commit SHA), so each request is unique and time-bound.

**Step 1 — Webhook server on the host:**
```python
#!/usr/bin/env python3
"""Deploy webhook with HMAC-SHA256 auth and deploy status tracking.

Auth: HMAC-SHA256 signature over raw request body (timestamp + sha).
Run: DEPLOY_SECRET=... python3 webhook-server.py 9002
"""
import hashlib, hmac, json, os, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

DEPLOY_SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/home/das/portfolio-v2/deploy.sh")
REPO_DIR = os.environ.get("REPO_DIR", "/home/das/portfolio-v2")
DEPLOY_LOG = os.environ.get("DEPLOY_LOG", "/tmp/deploy.log")
STATUS_FILE = os.environ.get("DEPLOY_STATUS_FILE", "/tmp/deploy-status.json")
SECRET = os.environ.get("DEPLOY_SECRET", "").encode()
if not SECRET:
    sys.exit("DEPLOY_SECRET is required.")

MAX_BODY_BYTES = 8192
MAX_SKEW_SECONDS = 300

def expected_signature(raw_body: bytes) -> str:
    return hmac.new(SECRET, raw_body, hashlib.sha256).hexdigest()

def write_status(running=False, success=False, error="", log_tail=""):
    with open(STATUS_FILE, "w") as f:
        json.dump({"timestamp": int(time.time()), "running": running, "success": success,
                   "error": error, "log_tail": log_tail}, f)

class Handler(BaseHTTPRequestHandler):
    def _deny(self, code: int):
        self.send_response(code); self.send_header("Content-Length", "0"); self.end_headers()

    def _json(self, data: dict, code: int = 200):
        body = json.dumps(data).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if self.path == "/deploy/status":
            try:
                with open(STATUS_FILE, "r") as f:
                    status = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                status = {"timestamp": 0, "running": False, "success": False, "error": "", "log_tail": ""}
            self._json(status); return
        self._deny(404)

    def do_POST(self):
        if self.path != "/deploy": self._deny(404); return
        try: length = int(self.headers.get("Content-Length", "0"))
        except ValueError: self._deny(400); return
        if length < 0 or length > MAX_BODY_BYTES: self._deny(413); return

        raw_body = self.rfile.read(length) if length else b""
        signature = self.headers.get("X-Deploy-Signature", "")
        if not hmac.compare_digest(signature, expected_signature(raw_body)):
            self._deny(403); return
        try:
            sent_at = int(json.loads(raw_body or b"{}").get("timestamp", 0))
        except (ValueError, AttributeError): self._deny(403); return
        if abs(time.time() - sent_at) > MAX_SKEW_SECONDS: self._deny(403); return

        self.send_response(202); self.send_header("Content-Length", "0"); self.end_headers()

        write_status(running=True, success=False)
        try:
            with open(DEPLOY_LOG, "a") as log:
                proc = subprocess.run(["bash", DEPLOY_SCRIPT], cwd=REPO_DIR,
                                      stdout=log, stderr=subprocess.STDOUT)
            with open(DEPLOY_LOG, "r") as f:
                lines = f.readlines(); log_tail = "".join(lines[-10:]).strip()
            write_status(running=False, success=proc.returncode == 0,
                         error="" if proc.returncode == 0 else f"exit {proc.returncode}",
                         log_tail=log_tail)
        except Exception as e:
            write_status(running=False, success=False, error=str(e))

    def log_message(self, format, *args): pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9002
    print(f"Deploy webhook on port {port}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
```

**Step 2 — GitHub Actions workflow (HMAC-signed):**
```yaml
name: Deploy
on:
  push:
    branches: [master, main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger deploy via signed webhook
        env:
          DEPLOY_SECRET: ${{ secrets.DEPLOY_SECRET }}
        run: |
          if [ -z "$DEPLOY_SECRET" ]; then echo "DEPLOY_SECRET not set"; exit 1; fi
          body='{"timestamp":'$(date +%s)',"sha":"'${GITHUB_SHA}'"}'
          signature=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$DEPLOY_SECRET" | awk '{print $2}')
          curl -sS -X POST https://webhook.dasdev.net/deploy \
            -H "Content-Type: application/json" \
            -H "X-Deploy-Signature: $signature" \
            --data "$body" --fail-with-body --max-time 30
```

**Step 3 — Deploy script (build from local files if uncommitted):**
```bash
#!/bin/bash
set -e
WEBHOOK_URL="${WEBHOOK_NOTIFY_URL:-}"
DEPLOY_LOG="/tmp/deploy-$(date +%s).log"

echo "[$(date)] Deploy triggered" | tee -a "$DEPLOY_LOG"
cd /home/das/portfolio-v2

# If there are uncommitted local changes (e.g. from Cursor), build from local files.
# Don't stash -- that hides the user's work.
if [ -n "$(git status --short)" ]; then
    echo "Uncommitted local changes detected. Building from local files..." | tee -a "$DEPLOY_LOG"
else
    echo "Pulling latest from GitHub..." | tee -a "$DEPLOY_LOG"
    git pull origin master 2>&1 | tee -a "$DEPLOY_LOG"
fi

echo "Installing deps..." | tee -a "$DEPLOY_LOG"
npm ci 2>&1 | tee -a "$DEPLOY_LOG"

echo "Building..." | tee -a "$DEPLOY_LOG"
npm run build 2>&1 | tee -a "$DEPLOY_LOG"

echo "Building docker image..." | tee -a "$DEPLOY_LOG"
docker build -t arriq-portfolio-v2 . 2>&1 | tee -a "$DEPLOY_LOG"

echo "Restarting container..." | tee -a "$DEPLOY_LOG"
docker rm -f arriq-portfolio-v2 2>/dev/null || true
docker run -d --name arriq-portfolio-v2 --network proxy arriq-portfolio-v2:latest 2>&1 | tee -a "$DEPLOY_LOG"

echo "Reloading caddy..." | tee -a "$DEPLOY_LOG"
docker exec caddy caddy reload --config /etc/caddy/Caddyfile 2>&1 | tee -a "$DEPLOY_LOG" || docker restart caddy 2>&1 | tee -a "$DEPLOY_LOG"

echo "[$(date)] Deploy complete" | tee -a "$DEPLOY_LOG"

if [ -n "$WEBHOOK_URL" ]; then
    curl -sS -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" \
      --data "{\"status\":\"success\",\"time\":\"$(date -Iseconds)\"}" --max-time 10 || true
fi
```

**Critical — Deploy script stashing hides user work:**
The old `deploy.sh` used `git stash push` before `git pull`. Every auto-deploy hid any uncommitted Cursor work in a stash. The user never saw their changes go live. **Fix:** Check `git status --short` instead. If uncommitted changes exist, skip the pull and build from local files. Only pull when the working tree is clean.

**Critical — Old static token leaked in git history:**
If a deploy token was ever committed to git (e.g. in `.github/workflows/deploy.yml`), rotating the GitHub secret is NOT enough — the old token is still in git history. Generate a completely new secret value, update both GitHub Actions and the webhook server, and use HMAC signatures going forward so the secret itself never travels over the wire.

**Critical — Webhook server dies silently:**
The webhook server (`python3 webhook-server.py 9002`) is a background process. It does NOT restart automatically on server reboot or crashes. If pushes stop auto-deploying, check: `ps aux | grep webhook` and `curl -I https://webhook.dasdev.net/deploy`. Restart manually: `DEPLOY_SECRET=... python3 webhook-server.py 9002 &`. For persistence, use systemd or pm2.

**Critical — Deploy webhook returns 200 before build finishes:**
The original webhook returned HTTP 200 immediately and ran `deploy.sh` in background via `subprocess.Popen`. If the build failed, GitHub Actions showed green. Fix: use `subprocess.run` (synchronous) and stream output back to a status endpoint (`GET /deploy/status`). GitHub Actions can poll the status endpoint, or you can increase `--max-time` on curl to wait for the full build.

**Critical — Feature branch code never auto-deploys:**
`deploy.sh` pulls `origin/master`. If you push a feature branch, the webhook still triggers but pulls master — the live site stays on old code. To see feature branch changes:
1. Merge first (clean): `git checkout master && git merge feature/dashboard && git push`
2. Manual deploy from branch (testing): checkout branch, build, restart container directly
3. Make deploy.sh branch-aware: parse the `ref` field from GitHub's push payload

**Pitfall — GitHub Actions timeout:**
The webhook endpoint must return within ~30 seconds or GitHub Actions marks the step failed. Either run deploy async (status endpoint pattern) or set `--max-time 180` in curl and return 202 immediately.

**Pitfall — Duplicate container names:**
`docker run` fails if a container with that name exists. Always `docker rm -f <name>` before recreating.

**Pitfall — Caddy container caches the Caddyfile on start:**
When the Caddyfile is volume-mounted from host (`./caddy/Caddyfile:/etc/caddy/Caddyfile`), editing the host file and running `docker exec caddy caddy reload` may silently fail to pick up changes. The container can be serving a stale cached config. **Fix:** `docker stop caddy && docker rm caddy && docker compose up -d caddy` to recreate the container with fresh mount.

**Pitfall — Cloudflared config corruption from repeated sed edits:**
Appending ingress rules with `sed -i` multiple times can produce malformed YAML (duplicate keys, mangled indentation). If `systemctl restart cloudflared` fails after edits, the config is likely corrupted. **Fix:** maintain a clean canonical config in version control, `sudo cp` it into place, then restart.

**Pitfall — Wildcard DNS overrides tunnel:**
Delete ALL wildcard A/AAAA records and root AAAA records. Only keep Tunnel-type DNS records.

**Pitfall — Adding a subdomain requires updating BOTH cloudflared AND caddy:**
1. Cloudflared tunnel ingress for the subdomain (`cloudflared tunnel route dns <id> <subdomain>`)
2. Caddy `handle` block reverse-proxying to the container
3. Restart BOTH services. Update one without the other and the subdomain will 404 or "server not found".

**Pitfall — `docker compose up -d` fails in foreground mode:**
Hermes' terminal tool rejects long-running compose commands in foreground. Use `background=true` with `notify_on_complete=true`, then `process(action='wait')` to confirm completion.
Use `Crosshair`, `Plus`, or `Plus` icons from Lucide as section markers alongside `text-sm tracking-widest uppercase` labels.

### Numbered Steps (01, 02, 03...)
Big monospace numbers + title + description. Animate with `whileInView` stagger.

### Project Cards
Aspect-ratio container, gradient overlay from bottom, text at bottom-left, arrow icon on hover.

## Fonts
Inter + Space Grotesk (or JetBrains Mono for code/terminal vibes):
```tsx
import { Inter, Space_Grotesk } from "next/font/google";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space" });
```

## macOS / SwiftUI Spring Physics Motion System

When the user wants a website that feels like macOS native apps (Xcode, SwiftUI), replace Framer Motion's duration-based easing with **spring physics** using `stiffness` and `damping` parameters. This mirrors SwiftUI's `.spring(response:dampingRatio:)` feel on the web.

### Why Springs Over Easing Curves
- Springs respond to interruption naturally — duration-based easing can't
- SwiftUI uses springs for ALL system animations (page push, sheet dismiss, button press)
- Pure CSS spring approximations exist via `cubic-bezier()` — zero JS layout thrash, GPU-composited

### Kinetics Library Spring Parameters (ckissi/kinetics)
Reference values for common interactions. Copy these into Framer Motion `transition` props:

| Interaction | Stiffness | Damping | SwiftUI Equivalent |
|-------------|-----------|---------|-------------------|
| Card resize / accordion | 320 | 24 | `response: 0.35, dampingRatio: 0.7` |
| Number counter / digit bump | 280 | 18 | `response: 0.4, dampingRatio: 0.6` |
| Toast overshoot | 200 | 15 | `response: 0.5, dampingRatio: 0.5` |
| Tab pill glide | 260 | 28 | `response: 0.35, dampingRatio: 0.75` |
| PIN input pop | 360 | 22 | `response: 0.25, dampingRatio: 0.7` |
| Push button press | 500 | 30 | `response: 0.15, dampingRatio: 0.8` |
| Page transition (slide) | 120 | 20 | `response: 0.6, dampingRatio: 0.65` |
| Magnetic button | 180 | 12 | `response: 0.45, dampingRatio: 0.5` |

**Framer Motion usage:**
```tsx
// Page transition — SwiftUI push feel
<motion.div
  initial={{ opacity: 0, x: 40 }}
  animate={{ opacity: 1, x: 0 }}
  exit={{ opacity: 0, x: -40 }}
  transition={{ type: "spring", stiffness: 120, damping: 20 }}
>
```

**CSS spring approximation (no JS):**
```css
.spring-320-24 {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

**Apple HIG motion principles to embed:**
1. Motion must be purposeful — no gratuitous animation
2. Brevity + precision — snappy, not drawn out
3. Realistic feedback — motion follows gesture expectations
4. Always respect `prefers-reduced-motion`
5. Use haptics/audio as supplement, never as sole feedback

**Pro.beui.dev patterns to adopt:**
- `lerp(0.18)` for cursor-following tooltips (smooth eased follow)
- `press(60ms)` for tactile button depress (pure CSS scale transform)
- `overshoot(1.08)` for toasts sliding past rest then settling
- `glide(0.4s, custom)` for tab indicators that measure target width before moving

### Reduced Motion (Non-Negotiable)
```tsx
import { useReducedMotion } from "framer-motion";

const reduceMotion = useReducedMotion();
// Pass reduceMotion ? false : { initial values } to all motion components
// Or set transition duration to 0.01ms when reduceMotion is true
```

---

## Dithering & Noise Effects

The user explicitly wants dithering effects (Bayer ordered, Atkinson error diffusion) layered over the dark terminal aesthetic. This adds texture and a retro-computing nod.

### Web Dithering Techniques

| Algorithm | Style | Best For |
|-----------|-------|----------|
| **Ordered (Bayer)** | Clean grid pattern, predictable | Hero overlays, subtle texture |
| **Atkinson** | Apple Lisa/Mac classic, organic | Image preprocessing, retro feel |
| **Floyd-Steinberg** | Smooth error diffusion | Full image dithering |
| **Blue Noise** | Organic, no visible patterns | Animated threshold shifts |
| **1-bit palette** | C64, Game Boy, PICO-8 | Decorative elements |

### Implementation Approaches

**1. CSS-only noise overlay (static):**
```css
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
}
```

**2. Canvas Bayer dithering (dynamic):**
```typescript
// Draw image to canvas, apply 8x8 Bayer threshold matrix
// Then use canvas as CSS background or render directly
const bayer8x8 = [
  [0,32,8,40,2,34,10,42],
  [48,16,56,24,50,18,58,26],
  [12,44,4,36,14,46,6,38],
  [60,28,52,20,62,30,54,22],
  [3,35,11,43,1,33,9,41],
  [51,19,59,27,49,17,57,25],
  [15,47,7,39,13,45,5,37],
  [63,31,55,23,61,29,53,21]
];
```

**3. Animated "living dither" (advanced):**
- Animate the threshold value over time
- Gives static images a subtle vibrating quality
- Use `requestAnimationFrame` + offscreen canvas for performance

### Dithering Resources
- `ditherit-v3` (alexharris/ditherit-v3 on GitHub) — client-side dithering with 11 algorithms
- `ascii-magic.com/styles/dither` — online dithering tool with palette presets (C64, Game Boy, PICO-8)
- `studio-ity.com/dither` — free online dithering with color control

---

## Pitfalls
- **Apostrophes in JSX**: Always use `&apos;` or `&#39;` to avoid ESLint `react/no-unescaped-entities`
- **Em dashes in user-facing copy**: This user explicitly rejects em dashes (`—`) as "looking so AI." Replace with periods, colons, or rewrite the sentence. Search with `grep -r "—" src/` and purge. Never leave em dashes in headlines, body text, or meta descriptions.
- **Static export + images**: Use `public/` folder; Next.js Image component needs `unoptimized` in static export
- **shadcn init**: Use `npx shadcn@latest` not `shadcn-ui@latest` (deprecated)
- **Build first**: Always run `npm run build` locally before Docker to catch type/lint errors
- **CSP `connect-src` must include form relay subdomains:** When using a self-hosted form relay (e.g., `formrelay.dasdev.net`), the site's `Content-Security-Policy` header must include that subdomain in `connect-src`. Otherwise the browser blocks `fetch()` with a CSP violation. Update `security-headers.conf` and `private-headers.conf`, then rebuild the Docker image so headers are baked in.
- **Caddyfile changes need container restart:** When Caddyfile is host-mounted, editing the host file is NOT enough — `docker restart caddy` is required to pick up changes
- **Docker network names**: Check `docker network ls` — the network is often just `proxy`, not the compose project name + `_proxy`
- **Duplicate container names**: `docker run` fails if a container with that name exists. Always `docker rm -f <name>` before recreating
- **Cloudflare Tunnel + DNS**: When using Cloudflare Tunnels, wildcard A/AAAA records (`*.dasdev.net`) or root domain AAAA records will bypass the tunnel and cause Error 522. Delete those DNS records and use Tunnel-type records instead.
- **Migration numbering collision when adding new tables:** If a migration prefix (e.g. `0004`) already ran on the live database, a new migration with the same prefix (e.g. `0004_project_reviews.sql`) gets silently skipped by `supabase db push`. Later migrations that depend on the new table then fail with "relation does not exist." **Fix:** run `supabase migration list` before creating new migrations. If a prefix is already applied, skip it and use the next available number. Renumber files in `supabase/migrations/` before pushing. Also watch for `supabase db push` failing mid-run — some migrations may already have applied and are recorded in `supabase_migrations.schema_migrations` while later ones didn't. If you see `effect/sql/SqlError: Failed to execute statement` on a column-add migration that already exists, the column is already there — remove that migration from the pending set and retry.
- **Edge function exists in repo but is not deployed:** Writing a `.ts` file in `supabase/functions/` does NOT make it live. `supabase functions deploy <name>` must be run explicitly. If the browser hits a 404 on `/functions/v1/<name>`, the function was never deployed. **Fix:** `supabase functions deploy <name> --project-ref <ref>` from the server. If the Supabase CLI is not installed on the user's machine, deploy from the server instead.
- **Deploy webhook server dies silently without DEPLOY_SECRET:** The Python webhook server refuses to start if `DEPLOY_SECRET` is unset. It does NOT auto-restart on server reboot or after crashes. If GitHub Actions shows green but the site doesn't update, check `ps aux | grep webhook` and `curl -I https://webhook.dasdev.net/deploy`. A 502 from Cloudflare means the tunnel is up but the webhook server is down. **Fix:** set `DEPLOY_SECRET` permanently in systemd service file or `~/.bashrc`, and use systemd or pm2 for persistence.
- **Static export prevents dynamic token routes:** Next.js `output: 'export'` cannot serve dynamic `/review/[token]` routes at runtime. All token-based public pages must use query parameters (`/review?token=xxx`) with client-side `useSearchParams`. Do not use `generateStaticParams` for dynamic token routes in static export.
- **Cursor-research handoff file must stay updated:** When adding new major features (review links, new auth patterns, new pages), update `cursor-research/cursor-prompt-v5.md` before pushing to GitHub. Cursor uses this file for context; stale prompts cause cursor to miss features and rebuild things that already exist.

### Status badge colors:
```tsx
const statusStyles: Record<string, string> = {
  live: "bg-green-500/10 text-green-400",
  "in review": "bg-amber-500/10 text-amber-400",
  "in progress": "bg-neutral-500/10 text-neutral-400",
};
```

### Responsive Checklist for Dashboard
- [ ] Login: no `autoFocus`, `text-base` inputs, centered with `justify-center`
- [ ] Stats: responsive text sizes (`text-xl sm:text-2xl`), smaller gap on mobile
- [ ] Cards: stack vertically on mobile (`flex-col sm:flex-row`), truncate long text
- [ ] Touch targets: buttons and inputs at least `py-3.5` (44px tall)
- [ ] Tap highlight: add `tap-highlight-none` class to buttons
- [ ] No hover-only animations: remove `whileHover` on mobile, keep `whileTap`

## Mobile & Native App Feel

### iOS Haptic Feedback (Web)

iOS Safari does **not** support `navigator.vibrate()` natively. Use the `ios-vibrator-pro-max` polyfill by Sam Denty to make `navigator.vibrate()` work transparently on iOS Safari, Android, and desktop.

```bash
npm install ios-vibrator-pro-max
```

```typescript
// src/lib/haptics.ts — client-only, import once
"use client";
import "ios-vibrator-pro-max";

export function triggerHaptic(pattern: number | number[] = 10): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  navigator.vibrate(pattern);
}

export const HapticPatterns = {
  light: 8,                       // nav links, small buttons
  medium: 12,                     // CTAs, form submits
  heavy: [10, 30, 10],            // major actions
  double: [8, 40, 8],             // menu toggle
  success: [10, 20, 10, 20, 10],  // form submitted
  error: [50, 30, 50],            // validation failed
  selection: 5,                   // picking from list
  toggle: [6, 20, 6],             // switch on/off
} as const;

/** Higher-order handler: wraps any click with haptic */
export function withHaptic<T extends HTMLElement>(
  handler?: (e: React.MouseEvent<T>) => void,
  pattern: number | number[] = HapticPatterns.light
): (e: React.MouseEvent<T>) => void {
  return (e) => {
    triggerHaptic(pattern);
    handler?.(e);
  };
}
```

**Key points:**
- Import the polyfill in a client-side file once. It patches `navigator.vibrate()` automatically.
- Call `triggerHaptic()` in any click handler. Works on iOS, Android, and desktop (no-op on desktop).
- **Never** create manual switch overlays per component. The polyfill handles overlay creation, event forwarding, and cleanup automatically.
- Client-side only: the polyfill touches `document` at import time. Do not import in server components or `layout.tsx`.
- For haptic patterns longer than 1000ms, import `enableMainThreadBlocking` from the library.
- iOS Simulator does NOT emulate the Taptic Engine. Always test on real hardware.

**Why not manual overlays?** Before `ios-vibrator-pro-max` existed, developers created invisible `<input type="checkbox" switch>` overlays per interactive element. That approach is deprecated — it requires ~50 lines of boilerplate per component, is fragile across iOS updates, and is now fully superseded by the polyfill.

**Pitfall — The import must be `"use client"`.** The polyfill accesses `document` during initialization. In Next.js, importing it in a server component or `layout.tsx` will crash with "document is not defined" during SSR. Always import in a client utility file and import that utility from client components.

**Pitfall — `write_file` HTML-encodes JSX angle brackets.** When using `write_file` to write `.tsx` files containing JSX (e.g., `<Link>`), the tool automatically encodes `<` as `\u003c` and `>` as `\u003e`. This corrupts the file. Use `terminal` with a heredoc (`cat > file << 'EOF'`) instead, or use `patch` with the `old_string`/`new_string` replace mode for targeted edits.

See `references/ios-web-haptics.md` for full implementation, platform detection, advanced options (debug mode, background popups, main thread blocking), and debugging tips.

### Spring Page Transitions

Next.js App Router supports `template.tsx` for route-level wrappers. Use Framer Motion `AnimatePresence` with directional sliding:

```tsx
// src/app/template.tsx
"use client";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -40 }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

Use `will-change-transform` on the animated container for 60fps on mobile.

### Mobile Navigation Patterns

Full-screen overlay with:
- Spring stagger on links (`stiffness: 200, damping: 22, delay: i * 0.06`)
- Hamburger → X rotation with spring physics
- Body scroll lock when open (`document.body.style.overflow = "hidden"`)
- Active dot indicator (`layoutId` for animated position)
- Escape key to close
- iOS haptic feedback on every link + button via `triggerHaptic()`
- `tap-highlight-none` class to remove ugly blue iOS tap flash

### Dot Matrix Component Tuning

When building dot-matrix text/wordmarks, iterate sizing with user feedback:

| parameter | small/pinprick | medium (good) | large (too big) |
|-----------|---------------|---------------|-----------------|
| radius | 1.5-2.0 | 2.4-2.6 | 3.0+ |
| gap | 8-10 | 6-7 | 4-5 |
| letterGap | 12-14 | 9-10 | 7-8 |
| container height | h-20 lg:h-32 | h-24 lg:h-40 | h-28 lg:h-48 |

- **Too small/hard to read**: increase radius + container, decrease gap
- **Overlapping dots**: increase gap, decrease radius
- **Rule of thumb**: radius should be ~35% of gap for clean readability

```tsx
// Good starting point for a 5-letter wordmark at desktop
<DotMatrix text="ARRIQ" gap={7} letterGap={10} radius={2.4} />
```

## Cursor IDE Integration

When the user wants to continue development in Cursor after initial scaffold:

1. Create a `cursor-research/` folder in the repo root with:
   - `design-direction.md` — identity, vibe, references, colors, fonts
   - `cursor-prompt.md` — detailed prompt with current issues, task list, file structure
   - Reference files (inspiration links, research notes, business info)
2. Commit and push: `git add . && git commit -m "docs: cursor research" && git push`
3. User opens Cursor, adds `cursor-prompt.md` to context via Ctrl+Shift+P → "Add file to context"

This preserves all design decisions and research across sessions so the user can iterate independently.

## Supabase Auth Integration

### Contact form → Lead → Client invite flow

```
Contact form POST → submit-lead edge function → Supabase leads table
Admin at /admin/leads → clicks "Send portal invite" → invite-client edge function
Client receives email → clicks magic link → /dashboard/login?token=xyz&type=invite
Login page detects invite token → shows "Create access key" form
Client sets password → gets workspace dashboard
```

**Critical — Edge functions need BOTH headers:**
Supabase Edge Functions require `apikey` AND `Authorization: Bearer *** headers. The contact form fetch must include both:

```typescript
const res = await fetch(functionsUrl("submit-lead"), {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  },
  body: JSON.stringify({ name, email, message, turnstile_token: token }),
});
```

**Critical — Invite tokens are in query params, not hash:**
Supabase sends invite links as `?token=xyz&type=invite` (URL search params), NOT `#token=xyz` (fragment/hash). The login page must read `window.location.search`, not `window.location.hash`.

**Critical — Auth redirects must use production URL, never window.location.origin:**
Inside a Docker build, `window.location.origin` evaluates to `http://localhost:3000`. Always hardcode the production URL:
```typescript
// WRONG: inside Docker this becomes localhost:3000
{ redirectTo: `${window.location.origin}/dashboard/reset` }

// RIGHT: hardcode production domain
{ redirectTo: "https://dasdev.net/dashboard/reset" }
```

**Critical — Edge function redirectTo must also be hardcoded:**
The `invite-client` edge function builds the redirect URL. If it reads `Deno.env.get("SITE_URL")` and that env var defaults to `http://localhost:3000`, the invite email links to localhost even if the frontend code is correct. Hardcode in the edge function:
```typescript
const redirectTo = "https://dasdev.net/dashboard/login";
```

**Pitfall — Supabase auth settings need matching Site URL:**
Even if the code hardcodes `dasdev.net`, the Supabase dashboard Authentication → URL Configuration → Site URL must also be set to `https://dasdev.net`. If it still shows `http://localhost:3000`, invite emails will redirect to localhost regardless of code.

**Pitfall — invite-client edge function needs SERVICE_ROLE_KEY:**
The `invite-client` edge function calls `admin.auth.admin.inviteUserByEmail()` which requires a `SERVICE_ROLE_KEY` env var. If this is missing, the function returns a generic 500 error. Set it in Supabase dashboard → Project Settings → API → `service_role` key (starts with `eyJ...`).

**Pitfall — Supabase Auth email rate limits are tiny on free tier:**
The default `auth.rate_limit.email_sent` is 2/hour. If multiple clients get invited in a row, `inviteUserByEmail` returns `429: email rate limit exceeded`. The fix is NOT just bumping the limit (though that helps). Consider replacing the entire Supabase invite flow with a PIN / access key system for small-business client portals.

### Access Key (PIN) Auth — Replaces Supabase Invite Emails

For small business clients (plumbers, HVAC, etc.), email invites via Supabase hit rate limits and feel clunky. Replace with self-activation via a short access key:

**Flow:**
1. Admin creates a client record → auto-generates an 8-char access key (e.g. `X7K9P2M3`)
2. Admin texts the key to the client
3. Client goes to `/dashboard/login` → "Activate with key" tab
4. They enter email + key + choose a password
5. Edge function validates key, creates auth user, links profile to client, burns the key
6. Auto-signed in, redirected to `/dashboard`

**Schema addition:**
```sql
alter table clients add column access_key text;
alter table clients add column access_key_created_at timestamptz;
create index clients_access_key_idx on clients (access_key) where access_key is not null;
```

**Edge function (`verify-access-key`):**
```typescript
// Receives { email, password, access_key }
// 1. Look up client by key
// 2. Verify email matches client.email (optional but recommended)
// 3. Create auth user with email_confirm: true (skip email verification since key is the verification)
// 4. Update profile: role = 'client', client_id = client.id
// 5. Clear access_key so it can't be reused
// 6. Return { ok: true, client_id }
```

**Frontend login page:**
- Add `activate` mode to login tabs (alongside signin/request)
- Fields: email, access key, password (new password = their "access key")
- POST to `verify-access-key` edge function
- On success: immediately sign in with `signInWithPassword({ email, password })` then redirect

**Admin panel:**
- Client detail page shows current key + "Copy key" + "Regenerate key"
- Creating a new client auto-generates a key and shows it in the success toast

**Why this beats Supabase invites for small biz:**
- No email rate limits, no "token expired", no "user already registered" errors
- Texting a PIN is faster and higher response rate than email for tradespeople
- Client doesn't need to find a magic link in their inbox
- Single-step activation: enter key + set password → done

**Security considerations:**
- Key is single-use and cleared on activation
- Consider adding an expiration (e.g. 7 days) via `access_key_created_at`
- Key characters should avoid ambiguous pairs: no `0`/`O`, `1`/`I`/`L`
- Use uppercase and normalize client input to uppercase before lookup

### Invite handler on login page

```typescript
useEffect(() => {
  if (typeof window === "undefined") return;
  const search = new URLSearchParams(window.location.search);
  const token = search.get("token") || search.get("code");
  const type = search.get("type");
  if (token && type === "invite") {
    setMode("invite");
    setNotice("Welcome! Create your access key to get started.");
  }
}, []);

async function handleSetPasswordFromInvite() {
  const search = new URLSearchParams(window.location.search);
  const token = search.get("token") || search.get("code");
  
  // Step 1: verify the invite token (this signs them in)
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: "invite",
  });
  if (verifyError) { /* show error */ return; }
  
  // Step 2: set their password
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) { /* show error */ return; }
  
  // Step 3: redirect to dashboard
  router.replace("/dashboard");
}
```

**Note:** `verifyOtp` options does NOT accept `password` in supabase-js v2. You must verify first, then call `updateUser` separately.

## References
- [references/bookmark-ui-research-2026-08.md](references/bookmark-ui-research-2026-08.md) — Bookmark-discovered animated UI components (Border Beam, Thinking Orbs, Liquid Metal, Originkit, Cuelume sounds), AI agent tools, and Cursor MCP servers for design/dev workflows
- [references/self-hosted-form-relay.md](references/self-hosted-form-relay.md) — Full Go + Docker form relay setup: CORS order, Gmail dedup fix, ntfy integration, CSP `connect-src` requirement
- [references/dashboard-session-2026-07-26.md](references/dashboard-session-2026-07-26.md) — Client dashboard scaffold: login gate, localStorage auth, project stats, updates feed, mobile responsive patterns, manual feature-branch deploy
- [references/ios-web-haptics.md](references/ios-web-haptics.md) — Full iOS web haptics implementation: invisible switch overlay for Taptic Engine on iOS 26.5+, React hook wrappers, mobile nav integration, Android fallback via navigator.vibrate()
- [references/macos-os-components-and-spring.md](references/macos-os-components-and-spring.md) — macOS OS components (Dock, Window), spring physics tokens, dithering strategy, Safari fixes, and complete file structure for AAA portfolio builds
- [references/portfolio-v5-session.md](references/portfolio-v5-session.md) — v5 session: multi-page architecture, spring transitions, iOS haptics, mobile nav, em-dash removal workflow
- [references/portfolio-aesthetics.md](references/portfolio-aesthetics.md) — User's preferred design references and vibe
- [references/cursor-research-workflow.md](references/cursor-research-workflow.md) — Session-specific details: critical fixes, handoff structure, commands for future sessions
