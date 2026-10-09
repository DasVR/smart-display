# Chores, jobs and alerts: `/api/tasks`

The display keeps one shared list of things to do and things to be told
about. People add to it from the phone remote's **Tasks** tab. Other
platforms (an assistant like Tomo or Instinct, a home-automation rule, a
shell script) use the HTTP API below, the MCP bridge, or both, and hear about
changes through webhooks.

There are two kinds of item:

| Kind | What it's for | When its time comes |
| --- | --- | --- |
| `chore` | Something to do: bins, plants, "call the dentist" | Pops up on the island once, then stays on the Clock view's **Today** list as overdue until someone marks it done |
| `alert` | A timed heads-up: "leave for practice", meds | Pops up on the island with a bell, then moves on by itself |

Either kind can repeat. When a repeating chore is marked done, it jumps to its
next time. If it's marked done early (bins out at noon for a 6 pm slot), that
counts for the current time slot, and the next one is the following slot.

This runs in production only (`ws-server.js`), like `/api/notify`. The data
lives in `data/tasks.json`.

## Auth

With no token set, the API is open to your LAN, like the rest of this
server. To lock it:

```bash
npm run api-token          # mints data/api-token and prints the header
npm run api-token -- --off # remove it again
```

You can also set `DISPLAY_API_TOKEN` in the server's environment. Once a
token exists, every `/api/tasks` and `/api/webhooks` request needs
`Authorization: Bearer <token>`. No restart is needed in either direction.

The kiosk and the phone remote don't use HTTP for tasks; they talk over the
existing `/ws` socket. So locking the API doesn't lock you out of the remote.

## Items

```json
{
  "id": "5010407a",
  "kind": "chore",
  "title": "Take out the bins",
  "notes": "Blue bin too",
  "at": "2026-10-12T22:00:00.000Z",
  "repeat": { "freq": "weekly", "interval": 1, "days": [1, 4] },
  "severity": "info",
  "source": "Tomo",
  "active": true,
  "nextDue": "2026-10-12T22:00:00.000Z",
  "snoozedUntil": null,
  "lastDoneAt": null,
  "doneCount": 0,
  "status": "upcoming",
  "repeatText": "Every week on Mon, Thu"
}
```

- `title` (required, ≤120 chars). Keep it readable from across a room.
- `kind`: `chore` (default) or `alert`.
- `at`: ISO time of the first occurrence. Defaults to now.
- `repeat`: leave it out for a one-off. Otherwise use a shorthand
  (`"hourly"`, `"daily"`, `"weekly"`, `"monthly"`) or a full rule:
  `{ "freq": "weekly", "interval": 2, "days": [1, 4] }`. `days` are weekdays,
  0 = Sunday, and only apply to weekly rules. A monthly rule on the 31st falls
  back to the last day of shorter months.
- `notes` (≤500 chars): shown under the title on the phone and in the
  island.
- `severity`: `info`, `ok`, `warn` or `error`. Alerts default to `warn`.
- `source` (≤40 chars): who added it. The island shows it as the label
  ("Tomo"), and the phone lists it.

Repeating times are computed in the display's local time zone, so a 7:30 am
daily item stays at 7:30 across daylight-saving changes.

Read-only fields:
- `nextDue`: when it's next due.
- `status`: one of `overdue`, `due` (an alert whose time has come), `today`,
  `snoozed`, `upcoming` or `done`.
- `repeatText`: the repeat rule in plain words.
- `doneCount`, `lastDoneAt`, `snoozedUntil`.

## Endpoints

| Method | Path | Body | Does |
| --- | --- | --- | --- |
| GET | `/api/tasks` | | All items, most urgent first. Filter with `?status=overdue,today` and `?kind=chore` |
| POST | `/api/tasks` | an item | Create. Returns `201 { task }` |
| GET | `/api/tasks/:id` | | One item |
| PATCH | `/api/tasks/:id` | fields to change | Edit. `POST` works too, for clients without PATCH. Changing `at` or `repeat` restarts the schedule |
| DELETE | `/api/tasks/:id` | | Remove it |
| POST | `/api/tasks/:id/done` | | Mark done. Repeating items move on; one-offs retire |
| POST | `/api/tasks/:id/snooze` | `{ "minutes": 60 }` | Push it back (default 15). The rule is unchanged |

A bad request gets a 400 with a reason: `{ "error": "title is required" }`.

```bash
# a weekly chore from an assistant
curl -X POST http://kiosk.local:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Take out the bins","at":"2026-10-12T18:00:00-04:00",
       "repeat":{"freq":"weekly","days":[1,4]},"source":"Tomo"}'

# a one-off alert in 20 minutes
curl -X POST http://kiosk.local:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Leave for practice\",\"kind\":\"alert\",
       \"at\":\"$(date -u -d '+20 min' +%FT%TZ)\",\"source\":\"Instinct\"}"

# what's waiting right now
curl 'http://kiosk.local:3000/api/tasks?status=overdue,due'
```

## Webhooks

Subscribe a URL and the display POSTs to it whenever an item is
`task.created`, `task.updated`, `task.deleted`, `task.due` (its time came)
or `task.done`.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/webhooks` | Lists subscribers. Secrets are never returned |
| POST | `/api/webhooks` | `{ "url", "events"?, "secret"?, "name"? }`. `events` defaults to all of them |
| DELETE | `/api/webhooks/:id` | |

Each delivery looks like this:

```
POST <your url>
Content-Type: application/json
X-Display-Event: task.due
X-Display-Signature: sha256=<hex HMAC of the body>   # only when you set a secret

{ "event": "task.due", "at": "2026-10-09T18:00:20.000Z", "task": { ...item } }
```

To check the signature, compute HMAC-SHA256 of the raw body with your secret
and compare. In Node:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-display-signature']));
```

Deliveries are fire-and-forget, with a 5 second timeout and no retries. A
slow or dead endpoint never holds up the display. Failures go to the server
log.

## MCP bridge

`scripts/tasks-mcp.mjs` is a dependency-free MCP server (stdio) over the API
above, so any MCP-capable assistant can use the list directly. Its tools:

- `list_tasks`
- `add_task`
- `update_task`
- `complete_task`
- `snooze_task`
- `delete_task`
- `notify_display` (a one-off island message; nothing is stored)

```json
{
  "mcpServers": {
    "smart-display": {
      "command": "node",
      "args": ["/path/to/smart-display/scripts/tasks-mcp.mjs"],
      "env": {
        "DISPLAY_URL": "http://kiosk.local:3000",
        "DISPLAY_API_TOKEN": "<if you set one>",
        "DISPLAY_SOURCE": "Tomo"
      }
    }
  }
}
```

`DISPLAY_SOURCE` names the assistant on everything it adds. It needs Node 18
or newer, and it only needs to reach the display over HTTP, so it can run on
another machine.

## On the display

- **Clock view, Today panel.** It lists overdue and today's items, up to
  five, plus a line for the next one coming up. Tap a circle to mark that
  item done. The panel doesn't appear at all until the first item exists.
- **Dynamic Island.** Each occurrence raises it once, with a bell glyph and
  the item's source as the label. A snoozed item raises it again when the
  snooze ends.
- **Phone, Tasks tab** (`/remote/tasks`). Items are grouped as Waiting,
  Today, Snoozed, Coming up and Done.
  - The + button opens a bottom sheet for adding a chore or alert.
  - Tap a circle to mark it done.
  - Tap a row for snooze (1 h or until tomorrow) and delete.
