# The wall's voice and sounds

The wall can talk, using [ElevenLabs](https://elevenlabs.io) text to speech,
and it has its own library of sound effects made once with ElevenLabs sound
generation. Both are optional: without a key the wall shows what it would
have said on the island, and every sound falls back to the built-in tapping
sounds.

Phone: **Stats → Sounds & voice** (`/remote/sounds`). Everything you can *say*
to the wall is in [voice-commands.md](voice-commands.md).

## Set up the key

On your phone: **Stats → Sounds & voice → ElevenLabs key**. Paste the key
from elevenlabs.io → Developers → API Keys and tap **Save**.

- The wall checks the key with ElevenLabs first and refuses one ElevenLabs
  says isn't valid. A restricted key that can't read your account is still
  saved; try **Say it** to hear whether it can speak.
- It's stored only on the kiosk, in `data/elevenlabs-key` (gitignored,
  owner-only). The phone can replace or remove it but can never read it
  back: the page shows just the last four characters.
- Once you've paired a phone (see [pairing.md](pairing.md)), only a paired
  phone or the wall's own screen can change the key. Before then any phone
  on your network can, like every other setting.
- It travels over your home network or Tailscale on the way to the wall, so
  set it from home or over Tailscale, not over a public network.

Or, on the kiosk:

```bash
printf '%s' 'YOUR_ELEVENLABS_KEY' > data/elevenlabs-key
chmod 600 data/elevenlabs-key
```

`ELEVENLABS_API_KEY` in the service's environment takes priority over the
file. The phone page then says the key is set on the display and leaves it
alone. The key is never logged and never sent to a phone. A restart isn't
needed: it's read when the wall next speaks.

## What it says

| When | It says |
| --- | --- |
| A timer finishes | "Pasta timer is done." |
| A reminder (alert) comes due | "Reminder: Call mom." |
| You say "Hey Siri, tell the wall" … "announce dinner is ready" | A two-note chirp, then "Dinner is ready." |
| "tell everyone we're leaving in five minutes" | The same, for anything after "tell everyone" |
| "say that again" | The last thing the wall said back to you |
| The **Say it** box on the phone page | Whatever you type |

`POST /api/voice/say` with `{ "text": "…" }` (or a plain-text body) does the
same from anything else. It takes the same Bearer token as `/api/tasks`, and
`?format=text` answers "Said on the wall." or "Shown on the wall.".

While the wall talks, the edge of the screen glows.

## Staying quiet and cheap

- **Quiet hours** (22:00 to 07:00 by default, on the wall's clock): the words
  still show, but nothing is spoken.
- **Off switch** on the phone page.
- **Cache.** Each sentence is synthesized once and kept in
  `data/voice-cache/`, so "Pasta timer is done." costs nothing the second
  time. The 300 most recent clips are kept.
- **Daily budget.** At most 3,000 new characters a day are sent to
  ElevenLabs (set it with `POST /api/voice { "dailyChars": … }`). It uses
  the Flash model, about half a credit per character, so even a full day
  is around 1,500 credits. The Creator plan has 100,000 a month.

If ElevenLabs is down, the key is wrong, or the budget is spent, the wall
shows the words and the phone page says why.

## Settings

`GET /api/voice` and `POST /api/voice` (token required):

| Field | Default | |
| --- | --- | --- |
| `enabled` | `true` | speak at all |
| `voiceId` | `JBFqnCBsd6RMkjVDRZzb` (George) | any voice ID from your ElevenLabs voice library |
| `model` | `eleven_flash_v2_5` | |
| `quietStart`, `quietEnd` | `22:00`, `07:00` | `HH:MM` on the wall's clock |
| `dailyChars` | `3000` | new characters per day |

Changing the voice or model starts a fresh cache, so phrases are paid for
again once.

## The sound library

One family: a writer's desk with good tech on it. Pencil taps and checkmarks,
notebooks opening, snapping shut and turning a page, a softened typewriter,
creamy lubed keyboard switches (a deep, rounded thock, not
a clack), and the soft rubber buttons, scroll-wheel clicks and haptic ticks of
a small pocket gadget. Everything is close, muted and dry. Nothing beeps, and
there are no bells: every prompt also says "no bells, no chimes, no dings"
(`NO_BELLS`), because ElevenLabs likes to add a ding to anything typewriter-ish.

| Sound | What it is |
| --- | --- |
| `info` | a pencil tap on a notebook page |
| `ok` | two creamy keypresses, the second a touch higher |
| `warn` | two muffled eraser taps on a hardcover notebook |
| `error` | a hardcover notebook set down flat |
| `severe` | four firm typewriter keys, the last one striking hard |
| `success` | a pencil checkmark, then one creamy keypress |
| `music` | three rising pocket-gadget buttons with haptic ticks |
| `schedule` | a notebook's elastic band snapping shut |
| `timer` | a desk timer ticking down to a click, then two keypresses |
| `reminder` | a pen click, two taps on the page |
| `announce` | a pocket recorder's button and a two-note haptic chirp |
| `morning` | a notebook opened, the page smoothed flat, one keypress |
| `goodnight` | a laptop lid's magnetic click, a pencil set down |
| `approval` | two fingertip taps on a pocket device's screen, with a buzz |
| `working` | a short burst of creamy typing |
| `done-claude` | a fountain-pen signature and the cap clicking on |
| `done-cursor` | a softened typewriter carriage return, a muted thunk |
| `done-hermes` | a page torn from a spiral notebook and folded |
| `done-ollama` | one deep spacebar thock |
| `install` | three slow scroll-wheel clicks |
| `update` | a page turned, then one quiet keypress |

Each sound is a prompt in `src/lib/sounds/library.js`, and every prompt ends
with the same desk description (`DESK`, then `NO_BELLS`) so they sit together. They're made
once and committed to `static/sounds/`. The kiosk only plays the files; it never calls ElevenLabs
to play a sound.

```bash
npm run sounds:generate                  # every sound that's missing
npm run sounds:generate -- --only timer  # just these (comma-separated)
npm run sounds:generate -- --force       # remake them
npm run sounds:generate -- --takes 3     # 3 takes each in static/sounds/takes/
```

To audition, make takes, listen to them on the phone page or in a file
browser, copy the one you like over `static/sounds/<name>.mp3`, delete
`takes/`, and run `npm run sounds:generate` once more to refresh
`static/sounds/index.json`. Then commit.

The small sounds that play all the time (tab taps, swipes, volume ticks)
stay synthesized on purpose: they need zero delay.

## Making sounds from the phone

You don't need a laptop to add or fill in sounds. On **Stats → Sounds & voice**
(needs the ElevenLabs key above) the wall can make them itself.

**Make a sound.** Describe it ("a pencil being sharpened", "a notebook snapping shut") and tap
**Make**. The wall sends it to ElevenLabs in the same quiet-desk style as the
rest (soft, creamy, muted, close-miked, and no bells unless you ask for
one), keeps the mp3 in `data/sounds/`, and plays it. Tap the chips for ideas,
or pick a length (otherwise the wall guesses: a tap is short, a ring is
longer). Start with `!` to send the words exactly as typed, with no house style
added.

**Use it for an event.** Under **Made on the wall**, each sound has a **Play it
for** menu. Pick `timer`, `reminder`, `announce` or any other library sound and
that event plays yours from then on, on the wall and on the phone. Pick
**Nothing yet** to put the original back.

**Fill in the stand-ins.** Any library sound without a recording shows a
**Make this sound** button, and **Make the N missing sounds** makes them all, one
after another. A sound made this way is tagged *made here* and takes over its
own event. **Make another take** gives a new version if you don't like it.

When the library's prompts change (as they did for the desk-and-keyboard
family), sounds made here from the old prompts are tagged *old style* and get
a **Remake in the new style** button; the bulk button becomes **Make N in the
new style** and remakes them along with any stand-ins.

Sounds made this way live only on the kiosk. To keep one in the repo (so it
survives a reinstall), use `npm run sounds:generate` as above.

### Cost and limits

- At most **24** sounds are kept. Delete one to make room.
- At most **90 seconds** of sound a day (the whole built-in library is about 25).
  The phone page shows the day's use.
- Clips are 0.5 to 6 seconds. Credits are roughly in proportion to length, so
  a failed or unwanted one still costs what it cost.
- Only the wall's own screen or a [paired phone](pairing.md) can make, assign
  or delete sounds (or any phone, before the first one is paired).

### API

Writes take the same Bearer token as `/api/tasks`. The list and the clips
don't, because the kiosk's player can't send a header.

| Call | |
| --- | --- |
| `GET /api/sounds/custom` | the list `{ sounds, assign, max, secondsToday, dailySeconds, hasKey }` |
| `GET /api/sounds/custom/<name>.mp3` | one clip |
| `POST /api/sounds/generate` `{ "idea": "a doorbell", "seconds": 2 }` | make one (`seconds` is optional) |
| `POST /api/sounds/generate` `{ "kind": "timer" }` | make the library's own sound for that event |
| `POST /api/sounds/assign` `{ "kind": "timer", "name": "doorbell" }` | play it for that event; `"name": null` undoes it |
| `DELETE /api/sounds/custom/<name>` | forget it |

Errors: `no-key`, `empty`, `too-many`, `daily-limit`, `rate-limited`,
`bad-key`, `failed` (ElevenLabs didn't answer or sent nothing), `unknown-kind`
and `not-found`.
