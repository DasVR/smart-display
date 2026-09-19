# Lyrics lookup, cache, and alignment

`src/lib/server/lyrics.js` tries, in order:

1. **Community word-sync** (`scripts/forced_align/community_lyrics.py`) - several
   free, keyless sources that publish per-word or per-syllable timing:
   - **AMLL TTML DB** (`api.amll.dev`) - community Apple-Music-like TTML
   - **NetEase Cloud Music YRC** - karaoke word clocks
   - **Kugou KRC** - karaoke word clocks
   - **syncedlyrics** with `enhanced=True` - Musixmatch word-level LRC, then line LRC
2. **Canonical lyric sheet** (`scripts/forced_align/canonical_lyrics.py`) - the
   text the singing aligner times against, looked up even when a karaoke
   file already exists (those files often clip or rewrite the words):
   - **Genius** when `GENIUS_ACCESS_TOKEN` is set and `lyricsgenius` is
     installed. Editorial sheets. Best text we can get without a paid
     Musixmatch license.
   - **LRCLIB** `plainLyrics` otherwise. Keyless, scored so a same-title
     hit for the wrong artist is rejected. This is the always-on equivalent.
3. **LRCLIB synced** (`lrclib.net`) - line-synced LRC if nobody published
   word clocks.
4. **On-device alignment** - the box records the play-through and stamps
   the canonical sheet onto the audio with the best singing aligner
   installed (see below). Community karaoke stays on screen until that
   result lands, unless those clocks collapsed.

Title matching is scored on every networked source. A "My Way" hit for the
wrong artist never reaches the Music view.

## The lyrics database

Everything the pipeline learns about a track lives in one SQLite file,
`data/lyrics.db` (override with `LYRICS_DB_PATH`). It uses Node's built-in
`node:sqlite`, so there is nothing to install; a Node older than 22.5 falls
back to the old memory-only cache and says so once at boot.

| table | one row per | holds |
|---|---|---|
| `lyrics` | artist + title + album + rounded duration | parsed lines (JSON), plain text, provider (`kugou-krc`, `amll-ttml`, `lrclib-synced`, ...), `word_level` flag, fetched-at, ttl |
| `alignments` | track fingerprint | on-device word clocks (JSON), `engine`, `precise` flag, created-at |

Reads happen on every now-playing poll, so they stay synchronous: a small
in-process map sits in front of the file and the file is WAL mode. Word-level
hits are kept for a year (they do not change); line-only hits are retried
after a month in case a community source has since published word clocks.
Misses are never written to disk, so a network blip cannot pin "no lyrics"
to a track across restarts.

Pre-DB `data/forced-align-cache/*.json` files are imported into the
`alignments` table the first time the DB opens. The boot log prints the row
counts:

```
lyrics db /home/das/projects/smart-display/data/lyrics.db: 212 tracks (140 word-level), 96 alignments (91 precise)
lyrics aligner: qwen (frame-accurate) available qwen,ctc,energy
```

## On-device alignment

`scripts/forced_align/align.py` picks an engine (`FORCED_ALIGN_ENGINE`,
default `auto`), best first:

| Engine | Needs | Precise | Notes |
|---|---|---|---|
| `whisperx` | CPU venv via `install-host-venv.sh` | yes | Demucs vocals, Whisper large-v3 timeboxes, singing-tolerant wav2vec2 stamps the canonical sheet. Auto's first pick. Do not `pip install whisperx` with bare pip. |
| `ctc` | `pip install torch torchaudio` | yes | Meta MMS_FA wav2vec2 CTC + Viterbi on the known sheet. 20 ms frames. Speech model, but it cannot collapse a verse onto one timestamp. Auto's second pick. |
| `qwen` | `pip install qwen-asr` (pulls torch) | yes | [Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B): speech NAR. On singing it often stamps a whole verse at one clock. Auto tries it last among precise engines and skips a collapsed pass. |
| `aeneas` | `pip install aeneas` plus espeak/ffmpeg | yes | DTW aligner; line-level fragments split by word weight. |
| `mfa` | Demucs + Montreal Forced Aligner | yes | Opt-in only. Heavy. Not used by `auto`. |
| `energy` | Python 3 only | no | RMS envelope vs lyric weights. Always on. A stand-in, not a measurement. |

"Precise" engines get their clocks from an acoustic model, so their result
**overrides community word timing** on screen and is cached as final. When a
precise engine is installed every fetched track gets aligned (community
clocks stay on screen until the model's result lands). With only `energy`,
alignment runs just for tracks nobody published word clocks for, and never
overrides a real karaoke file. An `energy` result is redone once a precise
engine appears. The rules are `shouldAlign()` in `forcedAlign.js` and
`pickDisplayLyrics()` in `hostData.js`.

Every word now carries `end` as well as `time`, so the karaoke fill can stop
at the end of the sung word instead of stretching to the next one.

`python3 scripts/forced_align/align.py --probe` prints the engine that would
run and whether it is precise; the server runs this once at boot. Skipping a
track cancels the in-flight recording so a leftover WAV capture does not
keep running.

`align.py` auto order is **whisperx, then CTC, then Qwen**. Qwen is a speech
model: on singing it often stamps a whole verse at one clock. CTC Viterbi
on the canonical sheet, and WhisperX (Demucs vocals + Whisper timeboxes +
wav2vec2, then a match onto that sheet), are the singing-capable paths.
`FORCED_ALIGN_ENGINE=qwen` still forces Qwen. Auto also skips a pass whose
clocks collapsed and tries the next engine.

### Installing the recommended aligner

Run this **on the das-server host** as user `das`, in a venv. Not in a
container, not in the Cursor Cloud agent pod. The box is CPU / Ryzen iGPU.
WhisperX 3.8 needs Python 3.10-3.13 and numpy 2. System python 3.14 cannot
import it. Do not `pip install "numpy<2" whisperx`: that resolves WhisperX
3.3 and `ctranslate2==4.4.0`, which has no 3.14 wheel.

```sh
# origin/master still has the python3.14 + numpy<2 recipe. Curl this copy:
curl -fsSL -o /tmp/install-host-venv.sh \
  https://raw.githubusercontent.com/DasVR/smart-display/cursor/lyrix-py312-d064/scripts/forced_align/install-host-venv.sh
bash /tmp/install-host-venv.sh --apply-systemd --recreate
sudo systemctl restart smart-display-server
# or by hand, on Python 3.12 (wipe a leftover 3.14 venv first):
sudo apt-get install -y python3.12 python3.12-venv python3.12-dev ffmpeg
rm -rf ~/venvs/lyrix
python3.12 -m venv ~/venvs/lyrix && . ~/venvs/lyrix/bin/activate
pip install -U pip
pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
pip install "whisperx>=3.7,<4" demucs syncedlyrics
```

Then point systemd at that interpreter (the script's `--apply-systemd`
flag writes the drop-in):

```
LYRICS_PYTHON_BIN=/home/das/venvs/lyrix/bin/python
FORCED_ALIGN_ENGINE=whisperx
FORCED_ALIGN_DEVICE=cpu
FORCED_ALIGN_WHISPER_MODEL=large-v3
FORCED_ALIGN_ALIGN_MODEL=jonatasgrosman/wav2vec2-large-xlsr-53-english
FORCED_ALIGN_SEPARATE=1
```

```sh
/home/das/venvs/lyrix/bin/python scripts/forced_align/align.py --probe
```

First transcription downloads faster-whisper `large-v3`. Diarization stays
off: no HuggingFace token. Demucs isolates vocals before WhisperX / CTC /
Qwen. Force off with `FORCED_ALIGN_SEPARATE=0`.

If you only want a timed lyric sheet and not on-device alignment,
**syncedlyrics** (already the community lookup) is the short road. It pulls
time-synced LRC from public sources with no token.

Genius / `lyricsgenius` is optional and usually the wrong tool here. It
needs a free client token from genius.com/api-clients, it is scrape-backed
so it breaks without warning, and it returns unsynced lyrics littered with
`[Chorus]` / `[Verse]` tags. Fine as an extra sheet. Useless as timing.

```sh
pip install qwen-asr            # speech NAR; auto no longer prefers it
# lighter known-text option if WhisperX is too heavy:
pip install torch torchaudio    # from the CPU index above; MMS_FA CTC Viterbi
```

On this CPU box a WhisperX pass runs after the song finishes, in the
background. Only set `FORCED_ALIGN_DEVICE=cuda:0` on a machine that actually
has NVIDIA CUDA.

### Optional MFA setup

```sh
conda create -n smart-display-align python=3.10
conda activate smart-display-align
pip install demucs
conda install -c conda-forge montreal-forced-aligner
mfa model download acoustic english_us_arpa
mfa model download dictionary english_us_arpa
```

Then start the server with `FORCED_ALIGN_ENGINE=mfa` and that env on `PATH`.

### Env vars

- `LYRICS_DB_PATH` - SQLite file (default `data/lyrics.db`).
- `LYRICS_PYTHON_BIN` - python for community lookup and alignment (default `python3`).
- `FORCED_ALIGN_ENGINE` - `auto` / `whisperx` / `ctc` / `qwen` / `aeneas` / `mfa` / `energy`.
- `FORCED_ALIGN_DEVICE` - `cuda:0` / `cpu` (default: CUDA when available).
- `FORCED_ALIGN_LANGUAGE` - language name passed to Qwen / WhisperX (default `English`).
- `FORCED_ALIGN_WHISPER_MODEL` - faster-whisper size for whisperx (default `large-v3`).
- `FORCED_ALIGN_ALIGN_MODEL` - wav2vec2 id for singing (default `jonatasgrosman/wav2vec2-large-xlsr-53-english`; empty uses WhisperX's language default).
- `FORCED_ALIGN_QWEN_MODEL` - HF id or local dir (default `Qwen/Qwen3-ForcedAligner-0.6B`).
- `FORCED_ALIGN_QWEN_MAX_SEC` - seconds per Qwen pass before chunking (default 240).
- `FORCED_ALIGN_SEPARATE` - `auto` / `1` / `0`: run Demucs before `whisperx` / `qwen` / `ctc`.
- `FORCED_ALIGN_DEMUCS` - optional path to the demucs CLI (defaults to the venv sibling of `LYRICS_PYTHON_BIN`).
- `GENIUS_ACCESS_TOKEN` - optional. Unsynced Genius sheet only; timed lyrics come from syncedlyrics.
- `FORCED_ALIGN_CACHE_DIR` - legacy JSON cache dir, imported into the DB (default `data/forced-align-cache/`).
- `FORCED_ALIGN_OFFSET` - set by the Node wrapper when recording did not start at 0:00.
