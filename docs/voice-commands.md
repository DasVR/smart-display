# Voice commands

Everything you can say to the wall, how it decides what you meant, and how to
check it before you rely on it.

You say these through **"Hey Siri, tell the wall"** (see
[siri-shortcuts.md](siri-shortcuts.md) for the shortcut), through the **Try a
phrase** box on the phone (**Tasks → Siri & Shortcuts**), or by sending text to
`POST /api/tasks/say`. They all go through the same code, so a phrase that
works in the box works from Siri.

## How a sentence is understood

1. **Cleaned up.** Curly apostrophes from Siri's dictation (`what’s`) become
   plain ones. Filler and politeness at the start are dropped: *hey wall,
   okay, um, can you, could you please, I'd like you to, go ahead and,
   tell the wall to*. So are tails like *please, thanks, for me, now*.
2. **Mishearings fixed.** *whether* becomes *weather*, *calender* becomes
   *calendar*, *rader* becomes *radar*. A real "whether or not" is left alone.
3. **Checked for adding first.** A sentence that starts with *remind me,
   alert, add, chore, to-do, I need to, I have to, I gotta* is always added to
   the list, never run as a command. "Remind me to turn the volume up at 6"
   is a reminder, not a volume change.
4. **Matched against the commands below.** The first match wins.
5. **Otherwise it's added.** Anything that isn't a command becomes a chore
   (or an alert, if it has "remind me" and a time). See "What it understands"
   in [siri-shortcuts.md](siri-shortcuts.md).

Commands are matched against the **whole** sentence, not a word inside it.
That's why "skip rope at 4" is a chore and "skip" is a command.

## The commands

### Your list

| You say | It does |
| --- | --- |
| I'm done with the bins / I just finished the dishes / the laundry was all done / mark feed the cat complete | ticks off the closest match |
| done | ticks off the most urgent thing that's waiting |
| snooze the cat for two hours / snooze the plants until tomorrow / snooze | snoozes it (an hour if you don't say) |
| what's on the wall / what's next / what do I have / brief | reads what's waiting and what's next |
| what's tomorrow / what do I have tomorrow | reads tomorrow's items |
| I'm leaving / what do I need to bring | reads the departure board and brings it up |
| undo that / scratch that / oops | takes back the last voice or Action-button change (up to five, ten minutes) |

### Timers

| You say | It does |
| --- | --- |
| set a timer for ten minutes / pasta timer 12 minutes / 1 hour 5 minute timer | sets it. The wall says it's done when it is |
| how long is left on the timer | reads the timers that are running |
| cancel the timer | cancels them |

### Looking things up

| You say | It does |
| --- | --- |
| what's the weather / will it rain / do I need an umbrella | reads now, the high, and when rain is likely |
| what time is it | "It's 7:20 AM." |
| what day is it / what's the date | "It's Friday, October 9." |
| what's this song / who is singing / what am I listening to | reads the title and artist |
| say that again / repeat that | repeats its last answer |
| help / what can you do | reads a short list of commands |

### The wall itself

| You say | It does |
| --- | --- |
| show me the weather / radar / forecast | switches the view |
| bring up the calendar / take me to the music / switch to the agents | the same, for clock, calendar, agents, music (and lyrics), weather |
| pause / play / resume / continue the music | music transport |
| next song / skip this song / previous song | music |
| turn it up / volume up / louder · turn it down / quieter | volume, 10% a step ("a lot" is 25%) |
| set the volume to forty / volume 40 percent | an exact level |
| mute / unmute | mute |
| goodnight / screen off · good morning / screen on | the panel |
| allow it / deny it | answers an agent that's waiting |
| announce dinner is ready / tell everyone we're leaving | the wall says it out loud (see [voice.md](voice.md)) |

A voice command never takes the volume past 100%. The slider on the phone
goes to 150% on purpose.

## Accuracy

**Dictation slips are forgiven.** When you name a chore ("done with the
vaccum"), the wall matches words, not letters:

- plurals and *-ing* forms match: *bin* finds "Take out the bins",
  *vacuuming* finds "Vacuum the living room";
- one slipped letter in a word of five or more letters is fine (*laundary*,
  *vaccum*); two in a word of nine or more;
- short words must match exactly, so *cat* never finds *cut*;
- *bring* isn't chopped down to *br* and mistaken for *ring*.

**It asks rather than guesses.** If your words fit two chores equally well and
neither is more urgent, nothing is ticked off:

> **You:** done with feed
> **Wall:** Which one: Feed the cat or Feed the fish? Say a bit more.

If one of them is due and the other isn't, the due one wins without asking.

**It never skips ahead.** "Done with the sheets" when the sheets aren't due
until next week says so and leaves them alone.

**Numbers can be words.** *two hours, thirty minutes, forty percent* work.

### Check a sentence without running it

The dry run shows what the wall makes of a sentence and does nothing:

```bash
curl 'http://<kiosk>:3000/api/action/parse?text=Hey%20wall%2C%20pause%20the%20music%20please'
```

```json
{
  "text": "Hey wall, pause the music please",
  "normalized": "pause the music",
  "command": { "intent": "music", "action": "pause" },
  "would": "run",
  "say": "Understood as music."
}
```

`would` is `run` (a command), `add` (it would go on the list) or `nothing`.
`POST` with `{ "text": "…" }` works too, and `?format=text` returns just the
`say` line. It takes the same Bearer token as `/api/tasks`.

This is the quickest way to tell *the wall misheard me* from *that isn't a
phrase it knows*.

### When it doesn't understand

- **It added a chore you meant as a command.** The sentence didn't match one
  of the phrasings above. Run it through the dry run, then try a closer
  wording, or say "undo that".
- **It ran a command you meant as a chore.** Start with "add" or "remind me
  to", which always add.
- **Siri sent something different from what you said.** Siri's dictation is
  the first step. Check the text in the shortcut's result; the Try a phrase
  box shows exactly what the wall received.

## Adding new commands

Commands are plain patterns in `parseCommand` in
[`src/lib/wallActions.js`](../src/lib/wallActions.js), and what each one does is
a `case` in `run` in [`src/lib/server/actionHub.js`](../src/lib/server/actionHub.js).
To add one:

1. Add a pattern to `parseCommand` that returns `{ intent: 'your-thing', … }`.
   Anchor it with `^…$` so it can't catch a chore.
2. Handle `your-thing` in `run` and return `{ say: '…' }`.
3. Add phrasings to `tests/voice-commands.test.mjs`, including a sentence that
   must **not** match.
4. Add a row to the table above.

`npm test` runs them.
