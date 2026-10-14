# Senses: the webcam's microphone and camera

One USB webcam, with its built-in microphone, lets the wall:

- **hear "hey wall …"** from across the room and do it, exactly as if you had
  said it to Siri ("hey wall, set a timer for ten minutes", "… what's the
  weather", "… pause the music", "… I'm done with the bins"). The answer is
  spoken in the wall's voice.
- **take notes** when you ask: "hey wall, take notes" writes down everything
  said near it until "hey wall, stop taking notes" (or the phone, or 30 quiet
  minutes). A red **Taking notes** mark sits on the wall the whole time.
- **see where you are in the room**: how many people are in view, which of
  your spots you're at ("bed", "desk"), lying down or upright, and how far
  from the wall. It finds whole people in any pose, so it works with your
  back turned and lying down, from a camera up high that sees the room. It
  turns the screen on when someone comes in (never at night), and art mode
  will lean its light toward you.

Settings are on the phone: **Stats → Senses**. Both the microphone and the
camera start **off**.

## What leaves the webcam

The webcam is read by a small local program on the display (`senses/`,
Python), not by the browser and not by the server. From that program to
the wall's server, and only on this machine:

| From the camera | From the microphone |
| --- | --- |
| how many people are in view | the words after "hey wall" |
| which remembered spot you're at, lying or upright | while notes are on: what was said |
| how far from the wall, in metres (once the floor is mapped) | how loud the room is (for the phone's meter) |
| where across the room, −1 to 1 | whether it's listening or thinking |
| outlines as boxes of numbers, for the phone's diagram | |
| how much of the picture moved, 0 to 1 | |

Never pictures, never sound. A frame is looked at and dropped (people are
looked for about twice a second); a piece of speech is held in memory only
until Whisper has turned it into words. People are found by YOLOX (or, in
face mode, faces by YuNet), which know a person is there and nothing about
who. There is no face recognition. The phone's diagram is drawn from the
boxes' numbers, never from the picture.

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

As `das` (not with `sudo`: the script asks for it only to install the
service):

```sh
/home/das/projects/smart-display/scripts/senses/install.sh --apply-systemd
```

The service file is filled in with the user, home and user id that ran the
script, so it also works for a user other than `das`. After that,
`scripts/deploy.sh` restarts it with each deploy.

That makes a venv at `~/venvs/senses` on the newest Python that
faster-whisper supports (3.12 on das-server), installs OpenCV 4,
faster-whisper and numpy, fetches the YuNet face model to
`~/.cache/wall-senses/` and the Whisper `base.en` model, then installs and
starts the service. Options:

- `--models tiny.en,small.en` also fetches other Whisper sizes, so the phone
  can switch to them. `tiny.en` is quickest, `small.en` most accurate.
- `--wake-word` also installs openWakeWord, for the lighter wake-word mode
  below. It is installed without its `tflite-runtime` dependency, which has
  no Python 3.12 build; the wall only uses its ONNX models. Its pre-trained wake words are CC BY-NC-SA: fine for a wall at
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

## The camera: whole people or faces

**Look for: whole people** (default) is for a camera up high that sees the
room, say a few inches above head height on the wall. It uses YOLOX-S from
the OpenCV Model Zoo (Apache 2.0, fetched by the install script, about
36 MB), run by OpenCV itself. It finds a person lying down, sitting with
their back turned, or seen from above; a wide outline reads as lying down.
Someone lying still is held for 6 s between sightings, so a missed frame
doesn't make you vanish.

**Look for: faces** is for a camera at face height that you look at; it
measures distance from face width (see Distance, faces).

### Spots

Where you are, by name, works lying down and with your back turned:

1. Phone → **Senses → Camera → Spots in the room**.
2. Get into a spot the way you usually are there: lying in bed, sitting at
   the desk.
3. Type its name and tap **Remember**, then hold still for three seconds.

It keeps the outline the camera saw you in (where in the picture, how big),
and from then on reports the remembered spot nearest the outline it sees.
Remember a spot again under the same name to improve it; up to 8 spots.

### Distance, from a sheet of paper

For metres from the wall:

1. Lay one sheet of printer paper (Letter or A4) **flat on the floor** in
   the open, where the camera sees it, **long edge toward the camera**.
   Keep other white things away from it, with the lights on.
2. Measure how far its near edge is from the wall under the camera.
3. Phone → **Senses → Distance, from a sheet of paper**: pick the size,
   enter the distance, tap **Find the paper**, and stay out of view for
   three seconds. The paper appears in the diagram. Then pick it up.

The paper's four corners and known size map the picture onto the floor; a
person's feet (the bottom of their outline) land on that map. Lying in bed,
the bottom of the outline is the mattress, not the floor, so expect that
reading to be a little off; the spot name is the better answer there. Put
the paper in the middle of the room for the best map.

Without a mapped floor, being in the room counts as "near" (for turning the
screen on); with one, "near" is the distance on the slider.

### Distance, faces

A face is about 15 cm across, so its width in pixels gives its distance:
`d = f × 0.15 / w`. Until you calibrate, `f` comes from a guessed 70°
field of view. To make it right: pick how far you'll stand, stand there
facing the wall, tap **Measure**. Expect about ±10% after that.

## The microphone from across the room

In the order a sound goes through them:

- **Turn up** (1× to 10×, default 3×) raises the webcam microphone in
  software, with a soft limiter so a door slam doesn't crackle. Turn it up
  until the meter moves well when you talk at normal volume from where you
  usually are. When listening starts, the webcam microphone's own volume
  is also set to 100% in PipeWire (webcams often come up at half).
- **Hear me from: across the room** (default) counts a voice as talking
  once it rises 1.6× above the room's noise; **close by** wants 3×. From
  across a room with a fan going, a voice is often only about twice the
  noise: at 3× it was never heard at all in testing.
- **Noise suppression** (Off, Light (default), Strong). While nobody talks,
  it learns the room's steady sounds at each pitch (a fan, a hum, hiss,
  even music that keeps playing) and takes them out of each phrase before
  Whisper reads it, with the Wiener filter phones and hearing aids use, so
  it doesn't warble. It follows the room as it changes.
- **Voice boost** (on) cuts rumble under 90 Hz and lifts the 1 to 4 kHz
  band, where consonants live and which distance dulls first.
- **Levelling:** every phrase is brought to full level before Whisper, so
  a faint voice comes through as clearly as a close one.
- **Whisper is told what talking to the wall sounds like** ("Hey wall, what
  time is it? Hey wall, pause the music."), so it expects "hey wall" and
  hears it when faint. Silero's voice filter keeps it from inventing those
  examples out of silence or hiss.
- **Whisper small.en** understands noisy, distant speech much better than
  base.en. The install script fetches both; pick small.en on the phone.

In testing, "Hey wall, set a timer for ten minutes" at a twentieth of its
volume under fan noise, hum and hiss louder than the voice: base.en alone
heard "Hey wall, ten times or ten baby"; small.en with noise suppression,
"Hey wall, it's a timer for 10 minutes", which the wall reads as a timer.
Pure noise, cleaned, gives nothing.

### Cleaner still: PipeWire's WebRTC processing (optional)

```sh
/home/das/projects/smart-display/scripts/senses/clean-mic.sh          # as das
/home/das/projects/smart-display/scripts/senses/clean-mic.sh --undo   # to take it away
```

This adds a new input, **Wall mic (cleaned)** (`wall_mic`), made by
PipeWire's echo-cancel module with WebRTC's processing, the same as video
calls: noise suppression, automatic gain, a high-pass filter and, on
PipeWire 1.0 or later, **echo cancellation of whatever the speakers play**,
so the wall can hear "hey wall" over its own music and voice. The senses
service listens to it by itself when it's there. The speakers and other
apps are left alone; PipeWire restarts, so music stops for a second. The
config (`~/.config/pipewire/pipewire.conf.d/60-wall-mic.conf`) is marked
`nofail`, so a problem with it can't take PipeWire's sound down. Tested on
PipeWire 1.0.5: the cleaned input appears, and `--undo` removes it.

## Under the hood

| Piece | Where |
| --- | --- |
| the webcam process | `senses/wall_senses/` (`hearing.py`, `denoise.py`, `seeing.py`, `bodies.py`, `room.py`, `vad.py`, `wake.py`, `distance.py`) |
| its tests (no camera or mic) | `senses/tests/`, run in CI: `cd senses && python3 -m unittest discover -s tests` |
| the server side | `src/lib/server/sensesHub.js`, `src/lib/senses.js`, `tests/senses.test.mjs` |
| the phone page | `src/routes/remote/senses/+page.svelte` |
| the wall | `{type:'presence'}`, `{type:'heard'}`, `{type:'listening'}` and `{type:'transcript'}` over `/ws`; `NotesMark.svelte` |
| install and service | `scripts/senses/install.sh`, `scripts/senses/clean-mic.sh`, `smart-display-senses.service` |

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
