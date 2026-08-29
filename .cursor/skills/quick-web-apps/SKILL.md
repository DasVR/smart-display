---
name: quick-web-apps
description: Build and serve small self-contained HTML/JS/CSS web utilities — single-file apps, tools, dashboards — and manage local preview servers.
version: 1.0.0
author: Finn
platforms: [linux]
metadata:
  hermes:
    tags: [web, html, javascript, local-server, preview, utility, single-file]
    related_skills: [claude-design, popular-web-designs, sketch]
---

# Quick Web Apps — Build & Serve Self-Contained Utilities

Use this skill when the user asks for a small web app, tool, calculator, tracker, or utility that can live in a single self-contained HTML file (embedded CSS + JS, no build step, no npm install). This is NOT for production web apps with frameworks — use repo-based skills for those. This IS for "can you make an app that does X" where X is simple enough to ship as one file.

## When To Use

- User asks for a quick app, tool, or utility ("can you make an app that...")
- The functionality is simple enough for vanilla JS (no framework needed)
- The deliverable is a working, usable tool — not a design exploration (use `claude-design` for that)
- No backend required (or the "backend" is just localStorage / browser APIs)

## When NOT To Use

- Production apps with React/Vue/Next → use repo-based development
- Design explorations or visual artifacts → use `claude-design`
- Multi-file projects with build tooling → use normal software dev workflow
- Apps requiring a real backend/API server → use appropriate backend skills

## Building The App

### Structure

Always produce a single self-contained `index.html` with:

- Embedded `<style>` block (no external CSS files)
- Embedded `<script>` block (no external JS files)
- No CDN dependencies unless absolutely necessary (and pin versions if used)
- Clean, modern UI — dark theme works well for utility apps

### Key Techniques

**localStorage for persistence** — save user input/settings so the app survives refresh:
```javascript
// Save
localStorage.setItem('appname', JSON.stringify({ text: value, setting: val }));
// Load on page load
const saved = JSON.parse(localStorage.getItem('appname') || '{}');
```

**Browser Notifications API** — for reminder/alert apps:
```javascript
// Request permission first
if (Notification.permission === 'default') {
  const perm = await Notification.requestPermission();
}
// Send notification
new Notification('🔔 Title', { body: 'message text', tag: 'unique-tag' });
```

**Scheduling with setInterval** — for time-based apps (reminders, clocks, etc):
```javascript
// Check every 30 seconds
setInterval(checkSchedule, 30000);
```

**Auto-resume on page load** — check localStorage and restore active state:
```javascript
window.addEventListener('load', () => {
  // Restore saved state, re-activate if was running
});
```

### UI Patterns For Utility Apps

- Centered container, max-width 400-600px for mobile-friendly tools
- Dark background (#0a0a0f or similar) with light text
- Card-based layout for settings/input sections
- Status badges (active/inactive) with pulsing dot animation
- Schedule/result lists with clear done/pending states
- Keep it minimal — utility apps don't need hero sections or marketing copy

## Serving Locally

After building the HTML file, serve it so the user can open it in their browser.

### Starting a server

```bash
# terminal(background=true) — servers are long-lived, never exit
cd /path/to/app-dir && python3 -m http.server <PORT> --bind 0.0.0.0
```

**Critical syntax notes:**
- The port is a **positional argument**: `python3 -m http.server 4001`
- Do NOT use `--port 4001` — this is wrong and will fail silently or error
- `--bind 0.0.0.0` makes it accessible from other devices on the LAN
- Always use `terminal(background=true)` — the server process never exits

### Verifying the server is up

After starting, always verify:
```bash
# foreground terminal call
sleep 2 && curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<PORT>/index.html
# Expect: 200
```

Give the server 1-2 seconds to start before curling. If you get `000` (connection refused), the process may not have started yet — wait longer and retry, or check the process list.

### Default port

Use 8080 as default. If the user asks for a different port, use that.

### Changing the port

When the user asks to switch ports:

1. **Kill the old server first** (foreground terminal):
   ```bash
   pkill -f "python3 -m http.server"
   ```
2. **Start new server** on requested port (background=true):
   ```bash
   cd /path/to/app-dir && python3 -m http.server <NEW_PORT> --bind 0.0.0.0
   ```
3. **Verify** with curl as above.

Do NOT start a new server without killing the old one — you'll get "address already in use" or the old port keeps serving stale content.

### Telling the user

Report the URL simply: `http://localhost:<PORT>` — one line, no over-explanation about server mechanics. If the user is on a different device than the host, use `http://<host-ip>:<PORT>`.

## Templates

- `templates/notification-reminder-app.html` — full working example of a reminder/scheduling app with browser notifications, localStorage persistence, auto-resume, and dark UI. Copy and modify for any "remind me of X throughout the day" or time-based notification utility.

## Pitfalls

- **`--port` flag does not exist** for `python3 -m http.server`. The port is positional. This is the #1 mistake.
- **Don't background a server with `&` in a foreground terminal call** — Hermes rejects this. Use `terminal(background=true)`.
- **Don't start a new server without killing the old one** — port conflicts or stale content.
- **Don't forget to verify with curl** — "server started" output doesn't mean it's actually reachable.
- **Don't over-engineer** — if the app can be one HTML file, keep it one HTML file. No need for package.json, build scripts, or frameworks.
- **Don't forget localStorage auto-resume** — utility apps should restore their state on page refresh. Users expect this.
- **Notification permission must be requested on user interaction** — calling `Notification.requestPermission()` on page load without a user click may be blocked by some browsers. Trigger it from a button click.

## Verification Checklist

Before telling the user the app is ready:

- [ ] HTML file written to disk (check with `read_file` or `ls`)
- [ ] Server started with `terminal(background=true)`
- [ ] `curl` returns 200 for the index page
- [ ] URL reported to user in one clean line
- [ ] Any important caveats mentioned (e.g. "keep tab open for notifications to fire")