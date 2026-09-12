# `/api/notify` — cross-tool event notifications

Lets any tool on your network (Claude Code, Cursor, the Hermes agent, a
shell script, anything that can make an HTTP request) push a message onto
the dashboard: it shows up as a black metaball emerging from the top-right
edge of the screen and plays a short, calm chime.

This only runs in production (`ws-server.js`), the same as the Bluetooth
`/api/bt/connected` endpoint — it needs the live WebSocket broadcast to
reach the display, which the SvelteKit dev server doesn't have.

## Request

```
POST /api/notify
Content-Type: application/json

{
  "title": "Build finished",
  "body": "3 files changed, tests passing",
  "severity": "ok",
  "source": "Claude Code",
  "ttl": 6000
}
```

- `title` (required, ≤120 chars) — the only required field.
- `body` (optional, ≤240 chars).
- `severity` — one of `info` (default), `ok`, `warn`, `error`. Drives the
  accent color and the chime's pitch/mood.
- `source` (optional, ≤40 chars) — shown in place of the generic severity
  label, e.g. `"Claude Code"`, `"Cursor"`, `"Hermes"`.
- `ttl` — how long it stays up, in ms (clamped 1000–30000, default 6000).

```bash
curl -X POST http://<display-host>:3000/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"title":"Tests failing","body":"3 of 42 red","severity":"error","source":"Claude Code"}'
```

## Wiring it up

**Claude Code** — a `Stop` or `PostToolUse` hook in `.claude/settings.json`
that curls the endpoint when a run finishes:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://<display-host>:3000/api/notify -H 'Content-Type: application/json' -d '{\"title\":\"Claude Code finished\",\"severity\":\"ok\",\"source\":\"Claude Code\"}'"
      }]
    }]
  }
}
```

**Cursor** — there's no first-party hook for this; the closest equivalent
is a terminal task or a small script run from Cursor's "Tasks" / a git
`post-commit` hook that does the same `curl` call with `"source":"Cursor"`.

**Hermes agent (or anything else)** — same request, any severity/source
you want. The endpoint doesn't care who's calling it.

## Known gaps

- **No auth.** Like the rest of this server's API, it's meant for a
  trusted LAN, not the open internet.
- **Chime playback needs one prior touch/keypress on the display itself**
  (a browser autoplay restriction) — after that, chimes play for every
  event without further interaction.
