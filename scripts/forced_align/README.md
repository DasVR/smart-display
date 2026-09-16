# Lyrics fallback tiers

`src/lib/server/lyrics.js`'s `fetchLyrics()` tries, in order:

1. **LRCLIB** (`lrclib.net`) - free, no key, no setup. Already wired up.
2. **`syncedlyrics`** - a Python package aggregating a few other providers
   (NetEase, Musixmatch, ...), for tracks LRCLIB's own database misses.
3. **Forced alignment** (this directory) - for tracks nothing above has
   synced timing for at all. Runs once per track, in the background, off a
   full AirPlay/Bluetooth play-through; the result is cached to disk under
   `data/forced-align-cache/` and reused on every later play. It never
   blocks the current play-through - the first time a song plays with no
   online sync, you still just get plain lyrics (or none) while the job
   runs; word-level synced lyrics show up starting the *next* time it plays.

## Tier 2 setup: `syncedlyrics`

```sh
pip install syncedlyrics
```

That's it - `scripts/forced_align/syncedlyrics_lookup.py` shells out to it.
If it's not installed, this tier silently no-ops and `fetchLyrics()` just
returns nothing found, same as today.

## Tier 3 setup: Demucs + Montreal Forced Aligner (MFA)

This tier needs real CPU (a few minutes per track) and ~1-2GB of one-time
model downloads, so it's meant for a proper machine, not the Raspberry
Pi-class kiosk box this repo also targets. It is entirely optional - the
first two tiers work with zero setup.

```sh
conda create -n smart-display-align python=3.10
conda activate smart-display-align
pip install demucs
conda install -c conda-forge montreal-forced-aligner
mfa model download acoustic english_us_arpa
mfa model download dictionary english_us_arpa
```

Then make sure `ws-server.js` runs with that env's `python3`, `demucs`, and
`mfa` on `PATH` (or point `LYRICS_PYTHON_BIN` at that env's `python3` and
prepend its `bin/` to `PATH`) before starting the server.

### How it works

- `src/lib/server/forcedAlign.js`'s `ensureAlignedLyrics()` is called from
  `getNowPlaying()` whenever a track has no synced lyrics from tiers 1-2.
- If we joined the track within its first few seconds, it records the rest
  of the play-through straight to a WAV file (`recordToWavFile()` in
  `audioCapture.js`, via `parec`'s system-audio monitor), using the plain
  lyric text LRCLIB already had for the track.
- Once recording finishes, `scripts/forced_align/align.py` isolates vocals
  with Demucs and aligns the lyric text to them with MFA, producing
  word-level timestamps, then writes them to
  `data/forced-align-cache/<fingerprint>.json`.
- Only one job runs per track at a time; a track fingerprint is
  `sha1(artist|title|duration)`, so a cache hit is instant on every later
  play and nothing re-runs the pipeline for a song it already has.

### Env vars

- `LYRICS_PYTHON_BIN` - python interpreter to use for both the
  `syncedlyrics` and forced-alignment subprocesses (default `python3`).
- `FORCED_ALIGN_CACHE_DIR` - where generated alignments are cached
  (default `data/forced-align-cache/`).
