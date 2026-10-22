# Voice tests (the wall's voice lab)

Everything here is local: it drives the wall's own server (HTTP 127.0.0.1:3000),
its real Phonon (phonon-40m-en, q8, inside the senses process) and its real
Parakeet STT. Nothing leaves the machine. One command reruns the whole lab:

    node voice-tests/run.mjs pace        # duration_delta timing table
    node voice-tests/run.mjs pronounce   # pronunciation round-trip, before/after
    node voice-tests/run.mjs voices      # the voice catalog + 6-voice comparison
    node voice-tests/run.mjs all

Sub-scripts run standalone too (`voice-tests/pace/run.mjs` etc.); `voice-tests/lib.mjs`
holds the shared client. WER numbers below compare Parakeet's transcript of Phonon
against the corpus text — treat WER as a **trend** metric, not truth: it penalizes
some strategies that are *better* for humans (spelling "HTTPS" as letters scores as
5 words against 1), so read it beside the actual `heard` transcripts, which are
saved in `before/transcripts.json` and `after/transcripts.json`.

## 1. Pace — `duration_delta` (the main lever)

The ptts 0.4.1 runtime takes a `duration_delta` condition: positive = slower,
0 = default (docs/cli.md). Both checkpoints (31m/40m) carry the conditioner
(`config.json`), verified 2026-10-22. Measured over `voice-tests/sentences.txt`
(8 sentences, ~2-25 words), 32 synthesized clips under `voice-tests/pace/`:

| delta | mean words/s | mean duration (8 sentences) |
| ----- | ------------ | --------------------------- |
| 0.0   | 2.33         | 5.63 s                      |
| 0.1   | 2.22         | 5.95 s                      |
| 0.2   | 2.15         | 6.23 s                      |
| 0.3   | 2.09         | 6.44 s                      |

**Recommendation: 0.2** (~8% slower than today, the docs' "small values are most
reliable" zone; 0.3 buys almost nothing more per the table). Short sentences move
less than long ones — the delta mostly buys inter-clause room.

**How to enable** (no systemd edit made — the owner decides):

    systemctl edit smart-display-senses.service
    [Service]
    Environment=WALL_VOICE_DURATION_DELTA=0.2

Per request instead: send body key `duration_delta` (clamped -0.5…0.5) on
`POST /v1/audio/speech`; `voiceBox.js` forwards it; absent = env default. Absent
and no env = today's behavior, so nothing breaks.

## 2. Pronunciation — the spoken lexicon

`hard_sentences.txt`: 41 lines of realistic Hermes output (repo and file names,
acronyms, versions, times, money, URLs, emails, paths). Current engine output in
`voice-tests/before/`, post-lexicon in `voice-tests/after/`.

Mean WER: before 0.319, after 0.386 — **the metric gets worse while the voice gets
more correct**, and the transcripts show why: the lexicon teaches the engine to
*spell* ("soo doo" for sudo, "system control" for systemctl, letters for HTTPS)
and Parakeet transcribes spellings as separate words, so WER counts them as
errors. Real wins visible in `heard`: *sudo systemctl restart smart-display-senses*
became sayable; *ptts 0.4.1 -> v0.23.0* became "point point" instead of mumble.
The losses are the ones worth editing by ear: URLs are babble in both passes
("one two seven point zero point zero v1 fed") — the next lexicon entry should
speak URLs as *"at wall example dot t s dot net"* style, and drop `UTTS`/`MPX`
corpus lines that are test-fixture noise.

The lexicon lives at `data/voice-lexicon.json`, hot-reloads on save (the voice
box re-reads it the moment it changes; a half-written file keeps the last good
copy). Format: `acronyms` (whole-word, case-sensitive map) + `rewrites` (ordered
regex → replacement). Ship-wide defaults in the repo copy; machine edits are
yours — it is untracked by default.

## 3. Voices

`phonon-voices/voices.jsonl`: **37 English voices** (en-us 12, en-gb 13, other
locales 12), full list printed by `node voice-tests/voices/run.mjs`. The
comparison says the default is the problem: **Easton is the fastest of the six
sampled voices** (2.91 words/s vs 2.61-2.75 for Harper/Juniper/Micah/Maeve/Edwin,
clips under `voice-tests/voices/<Name>/`). A naturally slower voice buys ~10%
pace without touching `duration_delta` — worth an A/B listen before settling the
delta value. Samples: `voice-tests/voices/<Name>/0[1-5].wav`.

## 4. Related fixes riding the same branch

- `senses/wall_senses/voicebox.py`: duration_delta plumbing (env + per-request),
  spoken-lexicon loading (hot-reload, safe on partial writes).
- `src/lib/server/voiceBox.js`: forwards `duration_delta` when present.
- `src/lib/server/attentionHub.js`: strips the gateway wire-wrap
  (`photon: [Thu 2026-10-22 14:48:28 EDT] "…"`) from island titles/bodies so the
  kiosk never shows raw transport lines.

## 5. What this lab does not test

Long multi-paragraph reads (MAX_TEXT=1000 wall cap still applies), SSML-like
control (Phonon has none beyond conditions), non-English `lang` (fixture is
English-only). WER stays noisy on digits — read `transcripts.json`, not just the
table.