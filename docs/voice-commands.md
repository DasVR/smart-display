# Voice commands

Everything you can say to the wall, how it decides what you meant, and how to
check it before you rely on it.

You say these through **"Hey Siri, tell the wall"** (see
[siri-shortcuts.md](siri-shortcuts.md) for the shortcut), through the **Try a
phrase** box on the phone (**Day → Siri & Shortcuts**), or by sending text to
`POST /api/tasks/say`. They all go through the same code, so a phrase that
works in the box works from Siri.

## How a sentence is understood

1. **Cleaned up.** Curly apostrophes from Siri's dictation (`what’s`) become
   plain ones. Filler and politeness at the start are dropped: *hey wall,
   okay, um, can you, could you please, I'd like you to, go ahead and,
   tell the wall to*. So are tails like *please, thanks, for me, now*.
2. **Mishearings fixed.** *whether* becomes *weather*, *calender* becomes
   *calendar*, *rader* becomes *radar*. A real "whether or not" is left alone.
3. **Matched against the commands below.** The first match wins. These are
   instant, free and work offline.
4. **Said as something to add: added.** *Remind me…, add milk to the
   (shopping) list, put … on my list, remember to…, make a note to…, I need
   to…, I have to…, chore…, to-do…*, and timers always go on the list. So
   does a plain sentence with a time that isn't a question ("call the
   dentist tomorrow"); "is it going to rain tomorrow?" is a question.
   "Remind me to turn the volume up at 6" is a reminder, not a volume change.
5. **Everything else is conversation.** With an Ollama key set, the
   sentence goes to a small AI model that talks back like a person and can
   act: run any of the commands below ("it's way too loud in here" turns it
   down), add to the list when you clearly want something remembered, play
   music, or look something up. "Thanks", "how are you", "tell me a joke"
   and "what should I cook tonight" get an answer, not a chore. See
   [assistant.md](assistant.md).
6. **No key: it asks before adding.** Anything that reached this step is
   asked about first: *"Should I add 'Tell me a joke' to your list?"*. Say **yes** (or
   *sure, add it*) or **no**. Nothing is added on a guess.

When the wall ends on a question, the microphone keeps listening for a few
seconds after it stops talking, so you answer without "hey wall" again (see
[senses.md](senses.md)). From Siri, answer with "tell the wall… yes".

Commands are matched against the **whole** sentence, not a word inside it.
That's why "skip rope at 4" isn't a command and "skip" is.

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

### When the wall is ringing

While something is calling for you (a timer, a reminder, an agent waiting,
severe weather; see [attention.md](attention.md)):

| You say | It does |
| --- | --- |
| got it / okay / thanks / dismiss / I heard you / quiet | answers it: the sound, the card and the glow stop |
| stop / stop the timer / stop ringing | the same. A bare "stop" only pauses the music when nothing is ringing |
| dismiss all | answers everything that's waiting |

Saying "got it" when nothing is ringing just says so; it never adds a chore
called "Got it".

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
| play bohemian rhapsody / play taylor swift / put on some jazz / play my workout playlist | plays it on Apple Music, on the wall itself (see [apple-music.md](apple-music.md)) |
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

`would` is `run` (a command), `add` (it would go on the list), `talk` (the
assistant would answer it, or the wall would ask before adding) or `nothing`.
`POST` with `{ "text": "…" }` works too, and `?format=text` returns just the
`say` line. It takes the same Bearer token as `/api/tasks`.

This is the quickest way to tell *the wall misheard me* from *that isn't a
phrase it knows*.

### When it doesn't understand

- **It added a chore you meant as something else.** It only adds what you
  said as something to add (step 4), what the assistant decided you wanted
  remembered, or a sentence with a time when there's no assistant. Say "undo
  that", and run the sentence through the dry run.
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
5. Add it to `INTENTS` in [`src/lib/intents.js`](../src/lib/intents.js) with two
   or three example phrasings. That puts it in `GET /api/action/intents`, the
   MCP bridge's `run_wall_intent` and the phone's "Everything you can say",
   and `tests/intents.test.mjs` checks the examples parse to it. See
   [`ledger-and-log.md`](ledger-and-log.md#intents-every-command-declared-once).

`npm test` runs them.
