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
| `whisperx` | `pip install whisperx` | yes | Whisper transcribes the singing, wav2vec2 stamps those words, then we map the clocks onto the canonical lyric sheet. Auto's first pick. |
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
on the canonical sheet, and WhisperX (Whisper + wav2vec2, then a match
onto that sheet), are the singing-capable paths. `FORCED_ALIGN_ENGINE=qwen`
still forces Qwen. Auto also skips a pass whose clocks collapsed and tries
the next engine.

### Installing the recommended aligner

```sh
pip install whisperx            # singing: Whisper + wav2vec2, maps onto the lyric sheet
pip install qwen-asr            # Qwen3-ForcedAligner (speech; auto no longer prefers it)
# or the lighter known-text option:
pip install torch torchaudio    # MMS_FA CTC Viterbi
python3 scripts/forced_align/align.py --probe
```

Optional canonical text (Genius editorial sheets). Without this, LRCLIB
plain lyrics are used:

```sh
pip install lyricsgenius
export GENIUS_ACCESS_TOKEN=...    # https://genius.com/api-clients
```

On a CPU-only box the Qwen pass takes on the order of a minute for a
four-minute track; it runs after the song finishes, in the background. Set
`FORCED_ALIGN_DEVICE=cuda:0` when a GPU is present.

Optional: `pip install demucs` and the `whisperx` / `qwen` / `ctc` engines align against
the separated vocal stem, which helps on dense mixes. Off automatically when
Demucs is not installed; force with `FORCED_ALIGN_SEPARATE=1|0`.

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
- `FORCED_ALIGN_WHISPER_MODEL` - faster-whisper size for whisperx (default `base`).
- `FORCED_ALIGN_QWEN_MODEL` - HF id or local dir (default `Qwen/Qwen3-ForcedAligner-0.6B`).
- `FORCED_ALIGN_QWEN_MAX_SEC` - seconds per Qwen pass before chunking (default 240).
- `FORCED_ALIGN_SEPARATE` - `auto` / `1` / `0`: run Demucs before `whisperx` / `qwen` / `ctc`.
- `GENIUS_ACCESS_TOKEN` - optional. With `lyricsgenius`, canonical text comes from Genius.
- `FORCED_ALIGN_CACHE_DIR` - legacy JSON cache dir, imported into the DB (default `data/forced-align-cache/`).
- `FORCED_ALIGN_OFFSET` - set by the Node wrapper when recording did not start at 0:00.
