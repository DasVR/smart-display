# `/api/notify` — cross-tool event notifications

Lets any tool on your network (Claude Code, Cursor, the Hermes agent, a
shell script, anything that can make an HTTP request) push a message onto
the dashboard. It shows up in the Dynamic Island at the top of the kiosk
and plays a short, calm chime. Default dwell is 9 seconds so the title is
readable from across the room.

This only runs in production (`ws-server.js`), the same as the Bluetooth
`/api/bt/connected` endpoint. It needs the live WebSocket broadcast to
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
  "ttl": 9000
}
```

- `title` (optional if `event` is `done`, `install`, or `update`, otherwise
  required, ≤120 chars).
- `body` (optional, ≤240 chars).
- `severity` — one of `info` (default), `ok`, `warn`, `error`. Drives the
  accent color. `event: "done"` defaults to `ok`, `install` to `info`,
  `update` to `warn`.
- `source` (optional, ≤40 chars) — shown in place of the generic severity
  label, e.g. `"Claude Code"`, `"Cursor"`, `"Hermes"`.
- `ttl` — how long it stays up, in ms (clamped 1000–30000, default 9000).
- `event` (optional):
  - `done` fills `{source} finished` (Cursor, Claude Code, Hermes, Ollama
    each get their own pencil-scribble finish sound)
  - `install` fills `{source} installing` / `Installing packages`
  - `update` fills `Package updates`, or `Packages updated` when severity
    is `ok`

The kiosk also raises some of these itself:

- volume changes from `/remote` (keycap pitch follows the slider, island
  says `Volume 72%` / `Muted`)
- night schedule edits (`Nights 22:30 to 06:00`)
- apt or firmware updates waiting (`Package updates` / `Firmware update`)
- the box then applies them (`Installing packages` / `Installing firmware`)
  on a smaller metaball under the island, with a progress bar and a
  matrix of beads that fill as each package completes
- `/var/run/reboot-required` after a kernel or firmware write
  (`Restart needed`)
- local Ollama going idle (`Agent finished`, source `Ollama`)

It does not chime for dashboard deploys (`npm ci`) or for git being
behind `origin/master`. Those are not OS updates.

```bash
curl -X POST http://<display-host>:3000/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"title":"Tests failing","body":"3 of 42 red","severity":"error","source":"Claude Code"}'
```

Shortcut when a run just ended:

```bash
curl -X POST http://<display-host>:3000/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"event":"done","source":"Cursor"}'
```

Or from this repo:

```bash
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-done.sh "Claude Code"
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-done.sh Cursor "PR checks green"
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-notify.sh done Hermes
```

Local Ollama runs do not need a hook. When the GPU handoff returns from
`LOW_POWER` to `HIGH_PERFORMANCE`, the server raises `Agent finished`
itself (source `Ollama`).

Bluetooth is the same idea on a different endpoint: `POST /api/bt/connected`
still jumps to Music, and also raises `Phone connected` (or `{device}
connected` when the watcher knows the Alias). AirPlay uses
`POST /api/airplay/connected` and raises `AirPlay connected` (or
`Apple Music connected` from the shairport hook). Now-playing still takes
the island once a track is actually playing, so those do not fight.

## Wiring it up

**Claude Code** — a `Stop` hook in `.claude/settings.json` that runs the
helper when a turn finishes:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "DISPLAY_HOST=http://<display-host>:3000 /home/das/projects/smart-display/hooks/display-done.sh 'Claude Code'"
      }]
    }]
  }
}
```

**Cursor** — there is still no first-party "agent finished" hook. Closest
paths that work today:

- a Cursor Task that runs `hooks/display-done.sh Cursor`
- a git `post-commit` hook that does the same
- any Cloud Agent / wrap-up script that can `curl` `/api/notify`

**Hermes agent** — same helper, source `Hermes`:

```bash
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-done.sh Hermes
```

The box watches apt and fwupd on its own. A hook is only needed if some
other tool should announce an install the kiosk cannot see.

## Known gaps

- **No auth.** Like the rest of this server's API, it's meant for a
  trusted LAN, not the open internet.
- **Chime playback needs one prior touch/keypress on the display itself**
  (a browser autoplay restriction) — after that, chimes play for every
  event without further interaction.
