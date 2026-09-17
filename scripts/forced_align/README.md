# Lyrics fallback tiers

`src/lib/server/lyrics.js`'s `fetchLyrics()` tries, in order:

1. **`syncedlyrics`** - a Python package aggregating several providers
   (NetEase, Musixmatch, ...). Tried first since it catches plenty of
   tracks LRCLIB's own crowd-sourced database misses.
2. **LRCLIB** (`lrclib.net`) - free, no key, no setup. Also the only source
   of plain lyric text for tier 3, so it's still checked on a tier-1 miss.
3. **Forced alignment / transcription** (this directory) - for tracks
   nothing above has synced timing for at all. Runs once per track, in the
   background, off a full AirPlay/Bluetooth play-through; the result is
   cached to disk under `data/forced-align-cache/` and reused on every
   later play. It never blocks the current play-through - the first time a
   song plays with no online sync, you still just get plain lyrics (or
   none) while the job runs; word-level synced lyrics show up starting the
   *next* time it plays. Two sub-cases:
   - LRCLIB had the plain words but no timing → **force-align** them to
     the vocal stem with MFA (accurate: it already knows what's sung).
   - Nothing anywhere has any text for the track (obscure/unreleased) →
     **transcribe** the vocal stem directly with Whisper, which produces
     its own text and word timestamps in one pass (less accurate, but the
     only option with nothing to align against).

## Tier 2 setup: `syncedlyrics`

```sh
pip install syncedlyrics
```

That's it - `scripts/forced_align/syncedlyrics_lookup.py` shells out to it.
If it's not installed, this tier silently no-ops and `fetchLyrics()` just
returns nothing found, same as today.

## Tier 3 setup: Demucs + Montreal Forced Aligner (MFA) + Whisper

This tier needs real CPU (a few minutes per track) and one-time model
downloads (~1-2GB for MFA, plus Whisper's model on first run), so it's
meant for a proper machine, not the Raspberry Pi-class kiosk box this repo
also targets. It is entirely optional - the first two tiers work with zero
setup.

```sh
conda create -n smart-display-align python=3.10
conda activate smart-display-align
pip install demucs openai-whisper
conda install -c conda-forge montreal-forced-aligner
mfa model download acoustic english_us_arpa
mfa model download dictionary english_us_arpa
```

`openai-whisper` is only used for tracks with no plain lyric text
anywhere online (see below) - skip it if that doesn't matter to you.

Then make sure `ws-server.js` runs with that env's `python3`, `demucs`,
`mfa`, and (if installed) `whisper`'s dependencies on `PATH` (or point
`LYRICS_PYTHON_BIN` at that env's `python3` and prepend its `bin/` to
`PATH`) before starting the server.

### How it works

- `src/lib/server/forcedAlign.js`'s `ensureAlignedLyrics()` is called from
  `getNowPlaying()` whenever a track has no synced lyrics from tiers 1-2.
- If we joined the track within its first few seconds, it records the rest
  of the play-through straight to a WAV file (`recordToWavFile()` in
  `audioCapture.js`, via `parec`'s system-audio monitor).
- Once recording finishes, `scripts/forced_align/align.py` isolates vocals
  with Demucs, then:
  - if LRCLIB had plain lyric text for the track (fetched via
    `fetchPlainLyricsText()`), it **force-aligns** that text to the vocal
    stem with MFA;
  - otherwise (no lyric text anywhere online), it **transcribes** the
    vocal stem directly with Whisper, generating both the text and its
    word timestamps.
  Either way the result is word-level timestamps, written to
  `data/forced-align-cache/<fingerprint>.json`.
- Only one job runs per track at a time; a track fingerprint is
  `sha1(artist|title|duration)`, so a cache hit is instant on every later
  play and nothing re-runs the pipeline for a song it already has.

### Env vars

- `LYRICS_PYTHON_BIN` - python interpreter to use for both the
  `syncedlyrics` and forced-alignment subprocesses (default `python3`).
- `FORCED_ALIGN_CACHE_DIR` - where generated alignments are cached
  (default `data/forced-align-cache/`).
