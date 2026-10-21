# The wall's ears and voice, everywhere

The wall hears with Parakeet and speaks with Phonon, both on its own CPU.
The **voice box** lends the two to whatever asks: your phone, your computer,
Hermes, and any app that speaks OpenAI's audio API. It costs nothing, needs
no account, and what you say goes to the wall and nowhere else.

```
phone / computer (remote voice sheet) ─┐
Hermes (voice mode, Telegram notes) ───┼─►  wall server :3000  /v1/audio/*   (checks who's asking)
any OpenAI-compatible app ─────────────┘            │
                                                    ▼
                                webcam process: voice box on 127.0.0.1:3011
                                Parakeet (the same model the wall's mic uses) · Phonon
```

## Set it up

On the display, once:

```bash
scripts/senses/install.sh --apply-systemd
```

That installs Phonon with the rest of the webcam process: `ptts` in its venv,
the 31M model (64 MB, Apache 2.0) and its 37 English voices (26 MB) into
`~/.cache/wall-senses`. The voice box starts with the process. Then pick a
voice on the phone: **Home → Sounds & voice → Phonon voice**. That voice is
used everywhere: the wall, your phone, your computer and Hermes.

The larger Phonon model sounds a bit better. It needs a free Hugging Face
account that has accepted its terms (CC BY-NC: fine at home), and is used by
itself once it's there:

```bash
HF_TOKEN=hf_... scripts/senses/install.sh --phonon-40m
sudo systemctl restart smart-display-senses
```

Install `ffmpeg` on the display too (`sudo apt install ffmpeg`): it lets the
voice box read recordings that aren't WAV (Telegram's voice notes), and lets
it answer in mp3 or Opus.

Check it: `curl -s localhost:3000/api/voice/box` should say `"stt": true, "tts": true`.

## On your phone and your computer

Open the remote at its https address (`https://<machine>.<tailnet>.ts.net/remote`,
see [remote-voice.md](remote-voice.md)): on the phone, and in any browser on
your computer. Hold the mic key, or tap it and just talk.

With the voice box running:

- **The wall does the listening.** The page records and the wall's Parakeet
  hears it, the words showing as you speak and checked once more when you
  let go. Questions keep their "?", and a "Hey display" at the start is dropped.
  Nothing goes to Apple's or Google's recogniser, and it works the same in
  any browser that has a microphone, Firefox included.
- **The answer is read in the wall's voice** on the device (**Answer on: This
  device**), or on the wall's speaker (**The wall**).
- Tapped open, it stops listening by itself when you pause.

Without the voice box (not installed, or the webcam process stopped) the
sheet goes back to the browser's own recogniser and voice, as before.

## Hermes

Hermes runs on the same machine as the wall, so it needs no token. In
`~/.hermes/config.yaml`:

```yaml
tts:
  provider: openai
  openai:
    base_url: "http://127.0.0.1:3000/v1"
    model: "phonon"          # ignored; the wall speaks with Phonon
    voice: "Harper"          # any Phonon voice; OpenAI's names (alloy…) get the wall's own voice

stt:
  provider: wall
  providers:
    wall:
      type: command
      command: "/home/das/projects/smart-display/scripts/voice/wall-stt.sh {input_path} {output_path}"
      format: txt
      language: en
      timeout: 120
```

and in `~/.hermes/.env` (Hermes wants a key there; the wall doesn't check it
from this machine):

```bash
VOICE_TOOLS_OPENAI_KEY=wall
```

If Hermes runs on another computer, use the wall's https address in both
places and give it the wall's API token: `VOICE_TOOLS_OPENAI_KEY=<data/api-token>`,
and `WALL_URL=https://<wall> WALL_TOKEN=<data/api-token>` in front of the
command.

Restart Hermes. Voice mode, read-aloud replies and voice notes from Telegram
now go through the wall. `scripts/voice/wall-stt.sh` reads any audio ffmpeg
can, so Telegram's `.ogg` notes work as they are.

## Any other app

Point any OpenAI audio client at `https://<wall>/v1` (or
`http://127.0.0.1:3000/v1` on the wall itself):

```python
from openai import OpenAI
wall = OpenAI(base_url="https://wall.example.ts.net/v1", api_key="<data/api-token>")
wall.audio.speech.create(model="phonon", voice="Easton", input="Dinner's ready.").write_to_file("dinner.mp3")
print(wall.audio.transcriptions.create(model="parakeet", file=open("note.m4a", "rb")).text)
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" -F file=@note.wav https://wall.example.ts.net/v1/audio/transcriptions
curl -s -H "Authorization: Bearer $TOKEN" -d '{"input":"Hello"}' https://wall.example.ts.net/v1/audio/speech -o hello.wav
```

| | |
| --- | --- |
| `POST /v1/audio/speech` | `{ input, voice?, response_format? }`: `wav` (default), `pcm` (24 kHz 16-bit), and with ffmpeg `mp3`, `opus`, `aac`, `flac` |
| `POST /v1/audio/transcriptions` | multipart `file` (or the audio as the body); `response_format` `json` (default), `text` or `verbose_json` |
| `GET /v1/audio/voices` | Phonon's voices: `{ voices: [{ name, description }] }` |
| `GET /v1/models` | what's here |
| `GET /api/voice/box` | `{ up, stt, tts, model, voices }` |

**Who may ask:** the wall itself, a paired phone or computer (its device
token as the Bearer, which the remote sends by itself), or the wall's API
token (`data/api-token`) for scripts and apps elsewhere. With no API token
set, it's open to the local network, like `/api/tasks`.

## Why these two

Measured on 4 CPU cores, with 15 short LibriSpeech clips and spoken "hey
display" commands:

| Ears | Size | Words wrong | Punctuation |
| --- | --- | --- | --- |
| **Parakeet TDT 0.6B v2** (kept) | 630 MB | 2.4% | yes, and "?" on questions |
| Underdog Bark 3.0 | 650 MB | 4.3% | none: all lower case, no "?" |
| Whisper small.en | | 6.1% | yes |

| Voice | Speed (2 cores) | First sound | Voices |
| --- | --- | --- | --- |
| **Phonon 31M** | 3.3 to 3.9x real time | about 0.1 s | 37 English |
| Kokoro 82M | 0.3 to 0.5x (slower than speaking) | | 11 |
| Piper | 6x | | one per download |

Phonon wins on sound and speed; Kokoro was too slow on this CPU to answer
without a wait.

## How it's built

| | |
| --- | --- |
| `senses/wall_senses/voicebox.py` | The voice box: 127.0.0.1 only (`WALL_VOICEBOX_PORT`, default 3011), shares the microphone's Parakeet (`stt.shared`), loads Phonon on first use. Never logs what was said. Tests: `senses/tests/test_voicebox.py`. |
| `src/lib/server/voiceBox.js` | `/v1/audio/*` and `/api/voice/box`: who may, OpenAI's shapes, ffmpeg for mp3/Opus. Tests: `tests/voice-box.test.mjs`. |
| `src/lib/server/voiceHub.js` | The wall speaking with Phonon (`engine: 'phonon'`, `phononVoice`), cached like every other clip. |
| `src/lib/services/wallEar.js` | The browser side: records, drafts the words as you speak, plays the answer. |
| `scripts/senses/fetch_phonon.py`, `scripts/voice/wall-stt.sh` | Fetching Phonon; the transcribe command for Hermes. |

Licences: Parakeet CC BY 4.0 (NVIDIA), Phonon 31M Apache 2.0 and 40M CC BY-NC
4.0 (Gradium), `ptts` MIT/Apache 2.0.
