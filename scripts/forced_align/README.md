# Lyrics lookup

`src/lib/server/lyrics.js` tries, in order:

1. **Community word-sync** (`scripts/forced_align/community_lyrics.py`) - several
   free, keyless sources that publish per-word or per-syllable timing:
   - **AMLL TTML DB** (`api.amll.dev`) - community Apple-Music-like TTML
   - **NetEase Cloud Music YRC** - karaoke word clocks
   - **Kugou KRC** - karaoke word clocks
   - **syncedlyrics** with `enhanced=True` - Musixmatch word-level LRC, then line LRC
2. **LRCLIB** (`lrclib.net`) - line-synced LRC and plain text, scored so a
   same-title hit for the wrong artist is rejected.
3. **On-device alignment** - if the hit is only plain text or line-synced LRC
   (no real word clocks), the kiosk records the rest of the play-through and
   aligns those words to the audio. The next poll of the same track picks up
   the cached karaoke timestamps, so you do not have to wait until the song
   plays again.

Title matching is scored on every networked source. A "My Way" hit for the
wrong artist never reaches the Music view.

## Community lookup

No API keys. The Python helper fans the four sources out in parallel and
keeps the first matching word-level hit. Install the optional aggregator
for Musixmatch / Megalobiz / Genius:

```sh
pip install syncedlyrics
```

AMLL, NetEase, and Kugou use only the stdlib. If a source is down, that
tier no-ops.

## On-device alignment

`scripts/forced_align/align.py` picks an engine (`FORCED_ALIGN_ENGINE`,
default `auto`):

| Engine | Needs | Notes |
|---|---|---|
| `energy` | Python 3 only | RMS envelope vs lyric weights. Always on. |
| `ctc` | `pip install torch torchaudio` | Meta MMS forced aligner, better word lock. |
| `aeneas` | `pip install aeneas` plus espeak/ffmpeg | DTW aligner. |
| `mfa` | Demucs + Montreal Forced Aligner | Opt-in only. Heavy. Not used by `auto`. |

`python3 scripts/forced_align/align.py --probe` prints the engine that
would run. Skipping a track cancels the in-flight recording so a leftover
WAV capture does not keep running.

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

- `LYRICS_PYTHON_BIN` - python for community lookup and alignment (default `python3`).
- `FORCED_ALIGN_ENGINE` - `auto` / `energy` / `ctc` / `aeneas` / `mfa`.
- `FORCED_ALIGN_CACHE_DIR` - default `data/forced-align-cache/`.
- `FORCED_ALIGN_OFFSET` - set by the Node wrapper when recording did not start at 0:00.
