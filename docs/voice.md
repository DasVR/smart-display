# The wall's voice and sounds

The wall can talk, using [ElevenLabs](https://elevenlabs.io) text to speech,
and it has its own library of sound effects made once with ElevenLabs sound
generation. Both are optional: without a key the wall shows what it would
have said on the island, and every sound falls back to the built-in tapping
sounds.

Phone: **Stats → Sounds & voice** (`/remote/sounds`).

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
| You say "Hey Siri, tell the wall" … "announce dinner is ready" | A two-note chime, then "Dinner is ready." |
| "tell everyone we're leaving in five minutes" | The same, for anything after "tell everyone" |
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

One family: paper, brass and glass in a quiet wooden room. Each sound is a
prompt in `src/lib/sounds/library.js`, made once and committed to
`static/sounds/`. The kiosk only plays the files; it never calls ElevenLabs
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
