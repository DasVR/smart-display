# `/api/notify` — cross-tool event notifications

Lets any tool on your network (Claude Code, Cursor, the Hermes agent, a
shell script, anything that can make an HTTP request) push a message onto
the dashboard. It shows up in the Dynamic Island at the top of the kiosk
and on the Agents tab. Start and finish events play a layered chime as
soon as they arrive. Default dwell is 9 seconds so the title is readable
from across the room.

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

- `title` (optional if `event` is `done`, `working`, `install`, or
  `update`, otherwise required, ≤120 chars).
- `body` (optional, ≤240 chars). Stored as the Agents-tab task line.
- `severity` — one of `info` (default), `ok`, `warn`, `error`. Drives the
  accent color. `event: "done"` defaults to `ok`, `working` and `install`
  to `info`, `update` to `warn`.
- `source` (optional, ≤40 chars) — shown in place of the generic severity
  label, e.g. `"Claude Code"`, `"Cursor"`, `"Hermes"`. Also picks which
  Agents card to update.
- `ttl` — how long the island slip stays up, in ms (clamped 1000–30000,
  default 9000).
- `event` (optional):
  - `working` (alias `start`) fills `{source} working`, marks that agent
    as in progress, plays a two-key start, and opens the Agents tab for
    Claude Code / Cursor / Hermes
  - `done` fills `{source} finished` (Cursor, Claude Code, Hermes, Ollama
    each get their own layered finish sound), marks the card done, and
    opens the Agents tab for Claude / Cursor / Hermes
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
- local Ollama going busy or idle (Agents tab plus `Agent finished`,
  source `Ollama`)

It does not chime for dashboard deploys (`npm ci`) or for git being
behind `origin/master`. Those are not OS updates.

```bash
curl -X POST http://<display-host>:3000/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"title":"Tests failing","body":"3 of 42 red","severity":"error","source":"Claude Code"}'
```

Shortcut when a run starts or just ended:

```bash
curl -X POST http://<display-host>:3000/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"event":"working","source":"Claude Code","body":"reviewing the Agents tab"}'

curl -X POST http://<display-host>:3000/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"event":"done","source":"Cursor"}'
```

Or from this repo:

```bash
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-working.sh "Claude Code" "editing SKILL.md"
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-done.sh "Claude Code"
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-done.sh Cursor "PR checks green"
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-notify.sh done Hermes
```

Local Ollama runs do not need a hook. When a model occupies VRAM the
Ollama card goes to working; when the GPU handoff returns from
`LOW_POWER` to `HIGH_PERFORMANCE`, the server raises `Agent finished`
itself (source `Ollama`).

Bluetooth is the same idea on a different endpoint: `POST /api/bt/connected`
still jumps to Music, and also raises `Phone connected` (or `{device}
connected` when the watcher knows the Alias). AirPlay uses
`POST /api/airplay/connected` and raises `AirPlay connected` (or
`Apple Music connected` from the shairport hook). Now-playing still takes
the island once a track is actually playing, so those do not fight.

Claude / Cursor / Hermes start and finish events jump to the Agents tab
the same way a phone connect jumps to Music.

## Wiring it up

**Claude Code** — `UserPromptSubmit` when a turn starts, `Stop` when it
finishes, in `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "DISPLAY_HOST=http://<display-host>:3000 /home/das/projects/smart-display/hooks/display-working.sh 'Claude Code'"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "DISPLAY_HOST=http://<display-host>:3000 /home/das/projects/smart-display/hooks/display-done.sh 'Claude Code'"
      }]
    }]
  }
}
```

**Cursor** — there is still no first-party "agent started / finished"
hook. Closest paths that work today:

- a Cursor Task that runs `hooks/display-working.sh Cursor` then
  `hooks/display-done.sh Cursor`
- a git `post-commit` hook that does the done ping
- any Cloud Agent / wrap-up script that can `curl` `/api/notify`

**Hermes agent** — same helpers, source `Hermes`:

```bash
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-working.sh Hermes
DISPLAY_HOST=http://<display-host>:3000 ./hooks/display-done.sh Hermes
```

The box watches apt and fwupd on its own. A hook is only needed if some
other tool should announce an install the kiosk cannot see.

## Known gaps

- **No auth.** Like the rest of this server's API, it's meant for a
  trusted LAN, not the open internet.
- **Chime playback needs one prior touch/keypress on the display itself**
  (a browser autoplay restriction) — after that, start and finish chimes
  play for every agent event without further interaction.
