# Senses: the webcam's microphone and camera

One USB webcam, with its built-in microphone, lets the wall:

- **hear "hey wall …"** from across the room and do it, exactly as if you had
  said it to Siri ("hey wall, set a timer for ten minutes", "… what's the
  weather", "… pause the music", "… I'm done with the bins"). The answer is
  spoken in the wall's voice.
- **take notes** when you ask: "hey wall, take notes" writes down everything
  said near it until "hey wall, stop taking notes" (or the phone, or 30 quiet
  minutes). A red **Taking notes** mark sits on the wall the whole time.
- **see how far away you are**: how many people are in view, how far the
  nearest one is, and which side of the room they are on. It turns the
  screen on when you walk up (never at night), and art mode will lean its
  light toward you.

Settings are on the phone: **Stats → Senses**. Both the microphone and the
camera start **off**.

## What leaves the webcam

The webcam is read by a small local program on the display (`senses/`,
Python), not by the browser and not by the server. From that program to
the wall's server, and only on this machine:

| From the camera | From the microphone |
| --- | --- |
| how many faces are in view | the words after "hey wall" |
| the nearest face's distance, in metres | while notes are on: what was said |
| where it is across the room, −1 to 1 | how loud the room is (for the phone's meter) |
| how much of the picture moved, 0 to 1 | whether it's listening or thinking |

Never pictures, never sound. A frame is looked at and dropped (5 a
second, at 320×240); a piece of speech is held in memory only until
Whisper has turned it into words. Face finding is YuNet, which knows a face
is there and nothing about whose it is. There is no face recognition.

The service is also **not allowed onto the network**:
`smart-display-senses.service` sets `IPAddressDeny=any` and
`IPAddressAllow=localhost`, so even a bug can't send anything off the
machine. That's why models are fetched by the install script, not on first
use.

Words are kept only when you ask for notes: they're written to
`data/transcripts/<date>.txt` (gitignored) when the notes stop, and you can
read and copy them on the phone. Commands aren't kept anywhere but the
wall's usual task list, if they add something to it.

## Install (on the display)

```sh
cd /home/das/projects/smart-display
scripts/senses/install.sh --apply-systemd
```

That makes a venv at `~/venvs/senses` on the newest Python that
faster-whisper supports (3.12 on das-server), installs OpenCV 4,
faster-whisper and numpy, fetches the YuNet face model to
`~/.cache/wall-senses/` and the Whisper `base.en` model, then installs and
starts the service. Options:

- `--models tiny.en,small.en` also fetches other Whisper sizes, so the phone
  can switch to them. `tiny.en` is quickest, `small.en` most accurate.
- `--wake-word` also installs openWakeWord, for the lighter wake-word mode
  below. Its pre-trained wake words are CC BY-NC-SA: fine for a wall at
  home.

`python -m wall_senses --list` (from `senses/`, with the venv's python)
lists the microphones and cameras it can see. `--check` shows what is
installed.

### Which microphone and camera

- **Microphone:** through PipeWire (`parec`, the same tool the music
  visualiser uses), so PipeWire resamples to 16 kHz. Without a setting it
  takes the first input whose name looks like a webcam (`usb`, `cam`,
  `C920`, `Brio`…), else the default source. Never a speaker monitor.
- **Camera:** `/dev/video0` unless set otherwise. The service runs as `das`
  with the `video` group.

## Waking it

- **A phrase** (default): every piece of speech has its first three seconds
  transcribed. Only when that starts with a wake phrase ("hey wall", "okay
  wall", or your own on the phone) is the rest transcribed and acted on.
  Whisper writes "hey wall" as "hey well" or "hey, wow" now and then; those
  count right after "hey" or "okay", nowhere else.
- **A wake word** (`--wake-word`): openWakeWord listens all the time for one
  of its words ("hey jarvis", "alexa", "hey mycroft", "hey rhasspy"), and
  Whisper only runs after it fires. It's lighter while music plays.

"Hey wall" on its own waits about seven seconds for the command. The edge
glow comes on while it listens and works.

**The wall never answers itself:** when the wall starts speaking, its ears
close for about as long as the sentence takes (`hushMsFor` in
`src/lib/senses.js`).

## Distance

A face is about 15 cm across, so its width in pixels gives its distance:
`d = f × 0.15 / w`. Until you calibrate, `f` comes from a guessed 70°
field of view, which is usually within 20%. To make it right:

1. Phone → **Senses → Distance**.
2. Pick how far away you'll stand (1 m is easy to measure).
3. Stand there facing the wall and tap **Measure**. It takes 2.5 s of
   frames and the median face width.

Expect about ±10% after that, a little more when you turn your head.
Someone with their back turned isn't a face, but still counts as
movement.

## Under the hood

| Piece | Where |
| --- | --- |
| the webcam process | `senses/wall_senses/` (`hearing.py`, `seeing.py`, `vad.py`, `wake.py`, `distance.py`) |
| its tests (no camera or mic) | `senses/tests/`, run in CI: `cd senses && python3 -m unittest discover -s tests` |
| the server side | `src/lib/server/sensesHub.js`, `src/lib/senses.js`, `tests/senses.test.mjs` |
| the phone page | `src/routes/remote/senses/+page.svelte` |
| the wall | `{type:'presence'}`, `{type:'heard'}`, `{type:'listening'}` and `{type:'transcript'}` over `/ws`; `NotesMark.svelte` |
| install and service | `scripts/senses/install.sh`, `smart-display-senses.service` |

HTTP, for the process (from this machine only):

- `POST /api/senses/state` with `{ camera, mic }`, about once a second and
  at once when someone moves. The answer carries the settings, `hushMs`,
  `notes`, and a `calibrate` job.
- `POST /api/senses/heard` with `{ kind: 'command' | 'note' | 'wake', text }`.
- `POST /api/senses/calibrated` with `{ id, focalPx, focalWidth }` or
  `{ id, error }`.
- `GET /api/senses` returns the snapshot. It needs the `/api` bearer token
  from anywhere but this machine.

Commands go through the same code as Siri and the phone's **Try a phrase**
box (`taskHub.sayAdd`, source "Wall mic"), so [voice-commands.md](voice-commands.md)
is the list of what it understands.
