# Cursor Research Workflow — Portfolio v2/v3 Session

## What Worked
1. Scaffold Next.js 14 + Tailwind + shadcn/ui + Framer Motion
2. Build dark editorial site with dot matrix hero, numbered sections, services
3. Dockerize with nginx:alpine
4. Add to existing Caddy reverse proxy on `proxy` Docker network
5. Update Cloudflare Tunnel config.yml to route `dasdev.net` to `localhost:80`
6. Delete wildcard A/AAAA records that were bypassing the tunnel
7. Push to GitHub repo with `cursor-research/` folder for handoff
8. Set up auto-deploy via Cloudflare Tunnel webhook (GitHub Actions → webhook.dasdev.net → server)

## Critical Fixes from This Session
- **Caddyfile host-mounted**: editing host file NOT enough — must `docker restart caddy` to re-read mount
- **Docker network name**: check `docker network ls` — was `proxy`, not `foundation_proxy`
- **Cloudflare Tunnel root domain**: AAAA record for `@` bypassed tunnel → Error 522. Deleted it, used Tunnel-type record
- **Wildcard DNS**: `*.dasdev.net` A + AAAA records also bypassed tunnel. Deleted them too
- **Dirty git repo blocks auto-deploy**: `npm run build` outputs to `dist/` which becomes untracked. `git pull` fails. Fix: `git reset --hard HEAD && git clean -fd dist/` in deploy.sh
- **Fire-and-forget webhook hides errors**: Original webhook returned "Deploy triggered" immediately. GitHub Actions showed green even when build failed. Fix: synchronous deploy with streaming output, grep for `[OK] Deploy SUCCESS` or `[FAIL] Deploy FAILED`

## Auto-Deploy Architecture
```
GitHub push
  → .github/workflows/deploy.yml (POST to webhook.dasdev.net/deploy)
  → Cloudflare Tunnel routes to server:9002
  → webhook-server.py verifies token, runs deploy.sh
  → deploy.sh: git reset → git pull → npm ci → npm build → docker rebuild → caddy reload
  → streams output back to GitHub Actions
```

## File Structure for Handoff
```
cursor-research/
  cursor-prompt.md               — detailed prompt for Cursor IDE
  design-direction.md            — identity, vibe, references, colors
  v3-real-site-analysis.md      — ACTUAL analysis from monolog.com + mainframe.co.uk
  v3-enhancement-research.md     — motion, typography, effects, webgl options
  portfolio-inspiration.md        — saved gallery links
  portfolio-research.md          — research notes
  hit-list-largo.md              — potential clients
  business-info.txt              — contact details, pricing
  dandrea-email-draft.txt        — cold email example
```

## Real Site Analysis Summary

### monolog.com (steal this)
- MASSIVE typography — "MONOLOG" spans full viewport width, ~120-150px
- Stat counters: "$2M+", "58%", "$100K+" in huge bold type
- "We close ‎ ‎ ‎ ‎ ‎ ‎ that gap" — invisible-width chars creating gaps
- Scattered image grid — not aligned, organic floating positions
- Numbered project prefix: "SS /05" format
- Project cards: left name + description, right BIG metric number
- Services as giant stacked words, not bullet points
- Founder headshot + attribution below quote

### mainframe.co.uk (steal this)
- Slash headers: "/ About (01)", "/ Work (02)"
- Duplicated CTA text: "Start a project Start a project →"
- Minimal text-only nav
- Service cards with images + hover states
- Image-dominant project grid
- Play showreel button with circular icon

## Commands for Future Sessions
```bash
# Build
cd /home/das/portfolio-v2 && npm run build

# Docker rebuild
docker rm -f arriq-portfolio-v2
docker build -t arriq-portfolio-v2 .
docker run -d --name arriq-portfolio-v2 --network proxy arriq-portfolio-v2

# Caddy reload
docker restart caddy

# Tunnel config update
sudo cat /etc/cloudflared/config.yml
sudo systemctl restart cloudflared

# Webhook status
curl -s -X POST http://localhost:9002/deploy -H "X-Deploy-Token: das-web-autodeploy-2026" -H "Content-Length: 0"

# Deploy logs
cat /tmp/deploy-*.log | tail -30
```

## .gitignore essentials
```
dist/
*.log
```

## GitHub Actions workflow (.github/workflows/deploy.yml)
```yaml
name: Deploy
on:
  push:
    branches: [master, main]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Deploy via tunnel webhook
        id: webhook
        env:
          TOKEN: ${{ secrets.DEPLOY_TOKEN }}
        run: |
          OUTPUT=$(curl -s -X POST https://webhook.dasdev.net/deploy \
            -H "X-Deploy-Token: $TOKEN" -H "Content-Length: 0" --max-time 180)
          echo "$OUTPUT"
          if echo "$OUTPUT" | grep -q "[OK] Deploy SUCCESS"; then exit 0; fi
          echo "Deploy failed — check server logs"
          exit 1
```
