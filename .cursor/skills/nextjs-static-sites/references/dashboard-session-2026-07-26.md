# Dashboard Session — Jul 26, 2026

## Context
User asked for a client dashboard inside portfolio v5, served at `test.dasdev.net`, with a branded login gate and simple project/update views.

## Files created
- `src/app/dashboard/login/page.tsx` — branded dark login gate
- `src/app/dashboard/layout.tsx` — shared dashboard shell
- `src/app/dashboard/page.tsx` — dashboard with stats, projects, updates

## Auth pattern used (placeholder)
LocalStorage gate. Any non-empty password grants access.

```tsx
// login
localStorage.setItem("dash_auth", "ok");

// dashboard guard
useEffect(() => {
  if (typeof window !== "undefined" && !localStorage.getItem("dash_auth")) {
    router.push("/dashboard/login");
  }
}, [router]);
```

## Mobile fixes applied
- Removed `autoFocus` on password input (prevents iOS Safari zoom)
- Changed input text to `text-base` (iOS won't zoom on focus)
- Used `min-h-screen justify-center py-12` instead of `min-h-dvh` with fixed padding
- Stats grid uses responsive sizes (`text-xl sm:text-2xl`)
- Cards stack vertically on mobile (`flex-col sm:flex-row`)
- Badges use `w-fit` so they don't stretch
- Text containers use `min-w-0` for truncate to work inside flexbox
- No `whileHover` on mobile, only `whileTap`

## Feature branch deploy (manual)
Deploy script pulls `master`, but dashboard was on `feature/dashboard`.
Manual deploy from checked-out branch:
```bash
cd /repo
git checkout feature/dashboard
npm run build
docker build -t <image> .
docker rm -f <container> && docker run -d --name <container> --network proxy <image>
docker restart caddy
```

## Subdomain wiring
Added `test.dasdev.net` to both:
1. `/etc/cloudflared/config.yml` (tunnel ingress)
2. `/opt/stacks/foundation/caddy/Caddyfile` (reverse proxy)

Restarted both services after edits.

## Critical gotcha: Caddy bind mount staleness
`docker restart caddy` did NOT pick up the new Caddyfile. The container was still serving the old cached config. Required full container recreation:
```bash
docker stop caddy && docker rm -f caddy
cd /opt/stacks/foundation && docker compose up -d caddy
```

**Verification:** Always check inside the container:
```bash
docker exec caddy cat /etc/caddy/Caddyfile | grep -n "<new-subdomain>"
```

## Notes
- `write_file` HTML-encodes JSX angle brackets — use `terminal` with heredoc for `.tsx` files instead.
- Dashboard is static-export friendly: no API routes, no server functions.
