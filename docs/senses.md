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
- **act on where you are**: settling at the desk can bring up Agents, lying
  down in bed at night turns the screen off, and an empty room can turn it
  off after a while (see Places). Getting up in the morning is the morning
  wake.
- **talk to you where you are**: the voice is a bit louder when you're
  across the room and softer lying down at night, and things said to an
  empty room are kept and said when you come back.

Settings are on the phone: **Home → Senses**. Both the microphone and the
camera start **off**.

## The sign on the wall, and Guest mode

Whenever the camera or the microphone is on, a small sign sits in the
wall's top-right corner: a camera and a microphone, white when on, blue
while it's working out what it heard, amber when it's turned on but the
webcam program isn't answering, and "Taking notes" while notes are on. It
never moves, so it can't be mistaken for decoration, and it's gone when both
are off ([`src/lib/sensesSign.js`](../src/lib/sensesSign.js)).

**Guest mode** (Home → Senses → Privacy) is for company: calendar titles
read "Busy", the Agents view is hidden, approval cards don't show the
command or the folder, and what the microphone heard isn't captioned. It's
off by default and only ever turned on by hand; nothing turns it on by
itself.

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
until Parakeet has turned it into words. People are found by YOLOX (or, in
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
onnxruntime supports (3.12 on das-server), installs OpenCV 4,
sherpa-onnx and numpy, fetches the YuNet face model and NVIDIA's Parakeet
speech model (about 480 MB) to `~/.cache/wall-senses/`, then installs and
starts the service. Options:

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
  "Hey wall" sometimes comes out as "hey well", "Hey Wal", or, said
  quickly on its own, "K Wal"; "hey wall, it's…" can run together as "Hey
  wallets…". Those count right after "hey" or "okay", nowhere else.
- **A wake word** (`--wake-word`): openWakeWord listens all the time for one
  of its words ("hey jarvis", "alexa", "hey mycroft", "hey rhasspy"), and
  the transcriber only runs after it fires. It's lighter while music plays.

"Hey wall" on its own waits about seven seconds for the command. The edge
glow comes on while it listens and works.

**Answering without "hey wall":** when the wall ends on a question ("Should
I add that to your list?", "What kind of music?"), the server keeps its ears
open for six seconds after it stops talking (`listenMs` in the heartbeat's
answer). Whatever you say then is the answer. One answer closes the window.

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

### Places

Each spot can do something (Phone → Senses → Spots in the room, under each
spot):

- **Settle here to show**: a page (Clock, Calendar, Agents, Music, Weather)
  that comes up after you've been in the spot about ten seconds. Once per
  arrival, and not within two minutes of picking a page yourself (on the
  wall or the phone; Smart Stack's own turns don't count).
- **Lying here at night turns the screen off**: during the voice's quiet
  hours, a minute of lying down in this spot turns the panel off. Getting
  up again (lying to upright) after the morning-wake time is the morning
  wake (Display schedule).

And for the whole room: **Nobody in the room: screen off after** 10, 30 or
60 minutes (or never).

**Walk out of the picture on the** left, right or either side turns the
screen off much sooner, after 10 seconds to 2 minutes (20 s by default).
Left and right are as you face the wall; pick the side your door is on. The
wall goes by where you were last seen: halfway or more to that side
(`x` at or past ±0.5) counts as leaving that way. If you disappear in the
middle of the picture, it's usually the camera losing you (a dark corner,
behind the couch), so nothing happens until the away timer above. The short
wait means a missed frame or two doesn't turn the screen off while you're
still there.

**Screen back on when you come back** (on by default) turns the screen on
again when someone is seen, but only if the camera is what turned it off.
If you, the schedule or anything else turned it off since, it stays off, and
it never comes on at night (quiet hours, or the schedule's off hours).
**Turn the screen on when someone comes near** works as before. The rules
are `placeStep` in `src/lib/senses.js`.

The answer to something you say to the wall is always spoken, even when the
camera can't see you at that moment. Only things the wall says on its own
(reminders, announcements) wait for **While you were out**.

### The voice and the room

With the camera on (Phone → Sounds → Voice; both on by default):

- **Follow where you are**: the voice plays at about three quarters of its
  volume within a metre, rising to a quarter more from 3.5 m away, and at
  60% when you're lying down during quiet hours. Without metres (no paper
  map yet), only the lying-down part applies.
- **Hold speech while nobody's home**: said to an empty room, it's only
  shown; when someone comes back the wall says "While you were out: …" (the
  last three, from the past 12 hours). Urgent things always speak.

### "That was wrong"

When it gets something wrong (misses you, puts you in the wrong spot,
mishears you, turns the screen off at a bad time), tap **That was wrong** on
the phone's Senses page right away, with a few words if you like. The
webcam process keeps the last 30 seconds of what it decided in memory:
what the camera counted (people, spot, posture, distance, outlines as
numbers), what the microphone made of each piece of sound (how long it was,
the words it heard, whether they were for the wall), and its log
lines. The tap saves that, with the presence the wall was told and its
settings, to `data/senses-reports/report-<time>.json` (gitignored, the last
50). Open and copy them on the phone. Numbers and words only, like
everything else here.

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
  it is transcribed, with the Wiener filter phones and hearing aids use, so
  it doesn't warble. It follows the room as it changes.
- **Voice boost** (on) cuts rumble under 90 Hz and lifts the 1 to 4 kHz
  band, where consonants live and which distance dulls first.
- **Levelling:** every phrase is brought to full level before it's transcribed, so
  a faint voice comes through as clearly as a close one.
- **Parakeet** (NVIDIA's Parakeet TDT 0.6B v2, int8, through sherpa-onnx)
  turns a phrase into words on the CPU. It replaced Whisper: on short spoken
  clips with 4 threads it took 0.5 s and got 2.4% of words wrong, against
  1.9 s and 6.1% for Whisper small.en and 0.8 s and 11.6% for base.en. On
  the wall a 2.6 s command takes about 0.35 s with 2 threads (the default;
  `WALL_SENSES_THREADS` changes it). It loads once in about 3 s and keeps
  about 1 GB of memory.
- **Nothing out of nothing.** Parakeet writes nothing for silence, hiss or
  static, where Whisper invented "Thank you." and could even write its own
  "hey wall" examples back out of the wall's music. It needs no examples to
  hear "hey wall" either: spoken test phrases came through word for word.

| Speech to text, CPU, 4 threads, 15 short phrases | Per phrase | Words wrong |
| --- | --- | --- |
| **Parakeet TDT 0.6B v2 int8** (the wall's) | **0.5 s** | **2.4%** |
| Moonshine v2 small | 1.1 s | 4.3% |
| Moonshine v2 medium | 1.5 s | 4.9% |
| Whisper small.en int8 | 1.9 s | 6.1% |
| Moonshine base | 0.3 s | 7.9% |
| Whisper distil-small.en int8 | 1.7 s | 8.5% |
| Moonshine v2 tiny | 0.6 s | 11.0% |
| Whisper base.en int8 | 0.8 s | 11.6% |

These are clean recordings (LibriSpeech); across a room with music on,
every model gets more wrong, but the order holds. Parakeet is English only.

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
| the webcam process | `senses/wall_senses/` (`hearing.py`, `denoise.py`, `diary.py`, `seeing.py`, `bodies.py`, `room.py`, `vad.py`, `wake.py`, `distance.py`) |
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
- `POST /api/senses/report` with `{ id, rows }`: the last 30 s of decisions,
  when the state answer asked for `report`.
- `GET /api/senses` returns the snapshot; `GET /api/senses/notes` lists the
  saved notes and `GET /api/senses/notes/<name>` returns one as text. They
  need the `/api` bearer token from anywhere but this machine.

For assistants, `scripts/tasks-mcp.mjs` has `room_presence`, `say_on_wall`,
`list_wall_notes` and `read_wall_note` (see [tasks-api.md](tasks-api.md#mcp-bridge)),
so any MCP-capable agent can ask whether anyone is home before speaking.

Commands go through the same code as Siri and the phone's **Try a phrase**
box (`taskHub.sayAdd`, source "Wall mic"), so [voice-commands.md](voice-commands.md)
is the list of what it understands.
