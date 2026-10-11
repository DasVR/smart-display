# Getting your attention

Most of what the wall shows is ambient: it slides in on the island and goes.
A few moments matter more. For those the wall works to be noticed, and keeps
at it until you answer.

## What counts

| Moment | How hard it tries | Sound | Wakes a dark panel |
| --- | --- | --- | --- |
| **A timer finishes** | urgent: rings at 6, 12, 18, 30, 45 and 60 seconds, then every 30 seconds for 10 minutes | `timer` | always, even in quiet hours: you set it |
| **An act-now weather warning** (tornado, severe thunderstorm, flash flood, hurricane…; see [weather-alerts.md](weather-alerts.md)) | urgent: again after 45 seconds and 2 minutes, then every 5 minutes for 15 minutes | `severe` | always |
| **An agent is waiting on you** | urgent: again after 20, 45 and 90 seconds, then every 2 minutes until it's answered or expires | `approval` | outside quiet hours |
| **A reminder comes due** | important: again after 30 seconds, 90 seconds and 3 minutes, then stops | `reminder` | outside quiet hours |
| **A chore comes due** | gentle: one more nudge after 5 minutes | `info` | never |

Each repeat is a little louder than the last, up to twice as loud as the
first. In quiet hours (the voice's quiet hours, 22:00 to 07:00 by default)
only timers and severe weather make a sound. The rest still show.

## What you see

- **A card in the middle of the wall**, big enough to read and hit from
  across the room: what it is, how long ago, and one button (**Stop** for a
  timer, **Got it** for the rest, **Later** and **Done** for a chore). Urgent
  cards breathe.
- **The edge of the screen glows** warm and breathes while anything urgent or
  important is waiting.
- **The panel comes on** if it was off (per the table). When everything's
  answered, a panel the wall turned on goes back off a minute later. If
  anyone turned it on or off by hand in the meantime, it's left alone.
- **The voice** says timers and reminders once the panel is on (see
  [voice.md](voice.md)).

Agents waiting on you keep their own Allow / Deny card at the bottom; the
attention list adds the repeats and the glow.

## Answering

Any of these answers the top item, everywhere at once:

- **The wall:** tap the card's button. **Done** on a chore ticks it off and
  **Later** snoozes it for an hour.
- **The phone:** the same card at the top of the remote.
- **The Action button:** one press answers it before doing anything else. The
  Wall menu leads with **Got it: …**.
- **Your voice:** "got it", "okay", "thanks", "dismiss", "stop", "stop the
  timer", "quiet", "I heard you" (see [voice-commands.md](voice-commands.md)).
  While something is ringing, a bare "stop" stops the ringing; otherwise it
  pauses the music.

It also goes away on its own when the thing behind it is settled (the chore
ticked off or snoozed, the agent answered, the warning ended or cancelled by
NWS), or when it ages out: 15 minutes
for a timer, 30 for a reminder, an hour for a chore.

## For other things

The list is kept on the kiosk (`src/lib/server/attentionHub.js`) and its rules
are in `src/lib/attention.js`. Anything the wall announces with a `notify`
message of kind `alert`, `approval` or `chore` becomes an attention item, and
act-now NWS warnings are raised by the server's alert watcher, so a reminder created through `/api/tasks` or an approval from
any agent rings the same way.

Over `/ws`: `{ "type": "attention", "op": "ack", "id": "…" }` answers one item
(leave out `id` for all), and every change is broadcast as
`{ "type": "attention", "items": [ … ] }`.
