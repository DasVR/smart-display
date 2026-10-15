# The Ledger, intents, the event log and surfaces

Four pieces of the redesign ([`redesign-plan.md`](redesign-plan.md)) that
sit under everything else.

## The Ledger: the day as one timeline

[`src/lib/ledger.js`](../src/lib/ledger.js) folds what the hubs know into
one list with three tenses:

| Tense | What's in it |
| --- | --- |
| **now** | anything ringing, overdue or due chores and alerts, agents waiting for Allow / Deny, act-now and watch-level NWS alerts |
| **soon** | chores, alerts and homework in the next 36 hours, NWS advisories |
| **past** | today's ticked-off chores, songs played and agent runs (from the day log) |

One fact is one entry. A chore that's ringing is the chore, with
`calling: { id, kind, since }` and a `Got it` action, not a chore plus a
separate attention item. Each entry carries the actions that make sense
for it (`ack`, `done`, `snooze`, `allow`, `deny`).

The hubs still keep their own files. The ledger is the read model:
`ledgerHub` rebuilds it when a hub broadcasts (coalesced) and once a
minute.

- `GET /api/ledger`: `{ now, soon, past, counts, at }`
- `GET /api/ledger?format=text`: one line, e.g. `2 need you: Feed the cat, Claude Code. 3 coming up.`
- WebSocket: `{ type: 'ledger', ledger }` when it changes, and `ledger` in `init`

The phone's Now pane and Day tab read it.

## Intents: every command declared once

[`src/lib/intents.js`](../src/lib/intents.js) lists everything the wall can
be asked to do: an id, a label, real phrasings and the parameters. The
spoken parser (`parseCommand`) is unchanged; a test checks that every
example phrase parses to its own intent, so the two can't drift.

From the list:

- `GET /api/action/intents`: every intent (`?format=text` for one per line)
- `POST /api/action/intent` with `{ "intent": "show", "params": { "view": "weather" } }`:
  runs it and answers what the wall said back. Parameters are checked and
  anything unknown is dropped. It's behind the same API token as the rest of
  `/api/action`.
- The MCP bridge's `run_wall_intent` tool, whose description and enum are
  generated from the list.
- The phone's **Day → Siri & Shortcuts → Everything you can say**.

To add a command: add the pattern to `parseCommand` and its `case` in
`actionHub` as before ([`voice-commands.md`](voice-commands.md#adding-new-commands)),
then add an entry to `INTENTS` with two or three example phrasings.

## The event log: the day as a recording

Everything the server broadcasts is written to
`data/log/YYYY-MM-DD.ndjson`, one `{ "t": <ms>, "m": <message> }` per line,
with a full `init` keyframe at start and every hour. Fourteen days are kept.

Never written: pairing codes and devices, what the microphone heard,
transcripts and notes, spoken clip URLs, audio frames, and the once-a-second
load and playback ticks. Lyrics are left out (they're in the lyrics store)
and long text is cut to 400 characters. Set `EVENT_LOG=off` to record
nothing.

- `GET /api/log`: the days on file. `GET /api/log/YYYY-MM-DD`: that day's
  file. Both answer only on the display itself (over SSH, or the kiosk's
  own browser).

Play a day back on a real build:

```sh
npm run build
npm run replay -- 2026-10-15 --from 07:30 --speed 30 --loop
# open http://localhost:3100 (wall) or /remote (phone)
```

The replay sends the state as of `--from` (the last keyframe plus
everything after it), then every message in order, sped up. Only the
socket is replayed: `/api/*` answers from the machine running it.

## Surfaces

Each screen says what it is in its `hello`
([`src/lib/surface.js`](../src/lib/surface.js)): wall, phone or tablet;
size; read across the room or in the hand; touch; GPU; motion.
`GET /api/surfaces` lists who's connected. The wall sets
`<html data-motion="full | lite">` from it: lite when the glass is flat, the
frame governor has throttled, or reduced motion is on. Today it's a flag;
there's no second screen.
