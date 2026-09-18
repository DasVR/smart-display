/**
 * Playback clock for now-playing UI.
 *
 * Cider highlights lyrics against the player's sample time (MusicKit /
 * HTMLAudio currentTime), not against a stale HTTP poll. This kiosk is not
 * an Apple Music client, so it cannot read AMP TTML syllable-lyrics. The
 * analogue we do have is a stamped sample: AirPlay `prgr` RTP clocks at
 * 44100 Hz, MPRIS `playerctl position`, then extrapolate while playing.
 *
 * Heartbeats and polls must refresh liveness (`updatedAt`) without moving
 * `positionAt`. Using `updatedAt` as the sample time rewinds lyrics every
 * second because the position field is still the last `prgr` reading.
 */

export function livePlaybackPosition(track, now = Date.now()) {
	if (!track) return 0;
	const position = Number(track.position) || 0;
	const length = Number(track.length) || 0;
	const sampledAt = Number(track.positionAt) || 0;
	const frozen = length > 0 ? Math.min(Math.max(0, position), length) : Math.max(0, position);
	// Mid-seek, `position`/`positionAt` are the pre-seek sample and about to
	// go stale - extrapolating off them would run the lyric highlight further
	// from reality every frame instead of just pausing it for the beat until
	// the next real progress report lands.
	if (!track.playing || !sampledAt || track.seeking) return frozen;
	const elapsed = Math.max(0, (now - sampledAt) / 1000);
	const next = position + elapsed;
	return length > 0 ? Math.min(next, length) : next;
}

export function activeLyricIndex(lines, position) {
	if (!Array.isArray(lines) || !lines.length) return -1;
	const t = Number(position) || 0;
	let idx = -1;
	for (let i = 0; i < lines.length; i++) {
		if ((Number(lines[i].time) || 0) <= t) idx = i;
		else break;
	}
	return idx;
}

/** Last-word fill without a real `end` clock. Long enough to sweep the
 *  letters, short enough that a rest after the line does not keep painting. */
export const DEFAULT_WORD_SPAN_SEC = 0.6;
/** Cap for inferring a last-word end from the next line / line.end. Wider
 *  gaps are instrumentals, not extra hold on the last syllable. */
const MAX_INFERRED_LAST_WORD_SEC = 1.5;
/** Hard cap on the last token of a line, even when TTML stamps an `end` that
 *  reaches the next verse. Without this the last letter keeps "singing"
 *  through the instrumental. */
export const MAX_LAST_WORD_SEC = 1.15;

/** Last-word fill stops here when a rest follows, so a far TTML `end` cannot
 *  keep the last letter singing through an instrumental. Held notes that
 *  run up to the next line (a long "us" then the next verse a beat later)
 *  keep their stamped end. */
function capLastWordEnd(start, end, nextLineStart) {
	const cap = start + MAX_LAST_WORD_SEC;
	if (!(end > cap)) return end;
	const next = Number(nextLineStart);
	if (Number.isFinite(next) && next > start) {
		const restAfter = next - end;
		const stampedThrough = end - start >= INSTRUMENTAL_GAP_SEC && Math.abs(next - end) < 0.45;
		if (restAfter >= INSTRUMENTAL_GAP_SEC || stampedThrough) return cap;
		return end;
	}
	return cap;
}

/** Clock when `words[index]` finishes. Prefers an explicit `end` from
 *  karaoke sources (TTML/YRC/KRC). Otherwise the next word's start, a tight
 *  `lineEndTime`, or a short default — never the start of a far-away next
 *  line, which used to stretch the last character through the rest. */
export function wordEndTime(words, index, lineEndTime, nextLineStart) {
	if (!Array.isArray(words) || index < 0 || index >= words.length) return 0;
	const start = Number(words[index].time) || 0;
	let end = start + DEFAULT_WORD_SPAN_SEC;
	const explicit = Number(words[index].end);
	if (Number.isFinite(explicit) && explicit > start) {
		end = explicit;
	} else if (index + 1 < words.length) {
		const next = Number(words[index + 1].time) || 0;
		if (next > start) end = next;
	} else {
		const lineEnd = Number(lineEndTime);
		if (Number.isFinite(lineEnd) && lineEnd > start && lineEnd - start <= MAX_INFERRED_LAST_WORD_SEC) {
			end = lineEnd;
		}
	}
	if (index === words.length - 1) end = capLastWordEnd(start, end, nextLineStart);
	return end;
}

/** Last clock on chorus / parenthetical rows tucked under this lead. */
function lastBackgroundEnd(line, nextLineStart) {
	const parts = line?.background;
	if (!Array.isArray(parts) || !parts.length) return 0;
	let last = 0;
	for (const part of parts) {
		const words = part?.words;
		if (Array.isArray(words) && words.length) {
			last = Math.max(
				last,
				wordEndTime(words, words.length - 1, part.end, nextLineStart)
			);
			continue;
		}
		const end = Number(part?.end);
		if (Number.isFinite(end) && end > last) {
			last = end;
			continue;
		}
		const start = Number(part?.time) || 0;
		if (start > last) last = start + DEFAULT_WORD_SPAN_SEC;
	}
	return last;
}

function lastVoiceEnd(line, nextLineStart) {
	const bgEnd = lastBackgroundEnd(line, nextLineStart);
	const words = line?.words;
	if (Array.isArray(words) && words.length) {
		return Math.max(
			wordEndTime(words, words.length - 1, line.end, nextLineStart),
			bgEnd
		);
	}
	const start = Number(line?.time) || 0;
	const lineEnd = Number(line?.end);
	if (Number.isFinite(lineEnd) && lineEnd > start) return Math.max(lineEnd, bgEnd);
	return bgEnd;
}

/** True once playback has passed the last sung clock on this line. Blank
 *  instrumental markers never count — those stay "on" so the dots can run.
 *  Parenthetical chorus rows under the lead keep the line live until the
 *  echo finishes, so the smaller text does not dim as soon as the lead does. */
export function lineSungThrough(line, position, nextLineStart) {
	if (!line?.text) return false;
	const t = Number(position) || 0;
	const end = lastVoiceEnd(line, nextLineStart);
	if (!(end > 0)) return false;
	return t >= end;
}

/** True while playback is inside this line's sung window. Overlapping
 *  duet lines can both be singing; the stack should paint both instead of
 *  treating the later start as "the" active row. */
export function isLineSinging(line, position, nextLineStart) {
	if (!line?.text) return false;
	const t = Number(position) || 0;
	const start = Number(line.time) || 0;
	if (t < start) return false;
	return !lineSungThrough(line, t, nextLineStart);
}

/** Index of the line currently being sung, or -1 when the last word has
 *  already finished and the next line has not started yet (the lyric stack
 *  goes dark across that rest instead of holding the last character). */
export function singingLyricIndex(lines, position, length = 0) {
	const idx = activeLyricIndex(lines, position);
	if (idx < 0) return -1;
	if (lineSungThrough(lines[idx], position, lines[idx + 1]?.time)) return -1;
	if (instrumentalRest(lines, position, length)) return -1;
	return idx;
}

export function activeWordIndex(words, position) {
	if (!Array.isArray(words) || !words.length) return -1;
	const t = Number(position) || 0;
	let idx = -1;
	for (let i = 0; i < words.length; i++) {
		if ((Number(words[i].time) || 0) <= t) idx = i;
		else break;
	}
	return idx;
}

export function lyricsAreSynced(lines) {
	return Array.isArray(lines) && lines.some((line) => Number(line?.time) > 0);
}

/** How far (0..1) `position` has swept through `words[index]`, for a smooth
 *  left-to-right fill within the word instead of an instant per-word snap —
 *  the "letter by letter" sweep Apple Music does. The word's span runs to
 *  its own `end` (or the next word). The last word of a line finishes at
 *  that end and stops; it does not keep filling across an instrumental. */
export function wordProgress(words, index, position, lineEndTime, nextLineStart) {
	if (!Array.isArray(words) || index < 0 || index >= words.length) return 0;
	const start = Number(words[index].time) || 0;
	const span = wordSpanSec(words, index, lineEndTime, nextLineStart);
	const t = Number(position) || 0;
	return Math.min(1, Math.max(0, (t - start) / span));
}

/** How long `words[index]` is actually sung. */
export function wordSpanSec(words, index, lineEndTime, nextLineStart) {
	if (!Array.isArray(words) || index < 0 || index >= words.length) return DEFAULT_WORD_SPAN_SEC;
	const start = Number(words[index].time) || 0;
	const end = wordEndTime(words, index, lineEndTime, nextLineStart);
	return end > start ? end - start : DEFAULT_WORD_SPAN_SEC;
}

/** Held notes (Cider / Apple Music letter-float): longer than a spoken
 *  syllable. Typical karaoke words sit around 0.3-0.55s; a held "you"
 *  or last chorus word runs past this. */
export const HELD_WORD_SEC = 0.78;

export function isHeldWord(words, index, lineEndTime, threshold = HELD_WORD_SEC, nextLineStart) {
	return wordSpanSec(words, index, lineEndTime, nextLineStart) >= threshold;
}

/** 0..1 fill for letter `index` of `count` given the word's --wp progress.
 *  Letters light in sequence with overlap so a long hold still feels like
 *  a wave, not a typewriter. */
export function letterFill(progress, index, count) {
	const n = Math.max(1, Number(count) || 1);
	const p = Math.min(1, Math.max(0, Number(progress) || 0));
	if (n === 1) return p;
	const start = (index / n) * 0.58;
	const span = 0.42 + 0.58 / n;
	return Math.min(1, Math.max(0, (p - start) / span));
}

/** 0 at the start and end of a letter's fill, 1 at the peak - drives the
 *  vertical wave + bloom so the lift happens while the letter is sung. */
export function letterWave(fill) {
	const f = Math.min(1, Math.max(0, Number(fill) || 0));
	return Math.sin(f * Math.PI);
}

/** True when the newly reported sample is a scrub/skip, not the next
 *  extrapolated frame. Used to snap lyrics instead of easing toward a
 *  stale clock. */
export function isPlaybackJump(prev, next, now = Date.now()) {
	if (!prev || !next) return false;
	if (next.seeking) return true;
	const prevAt = Number(prev.positionAt) || 0;
	const nextAt = Number(next.positionAt) || 0;
	if (prevAt && nextAt && prevAt === nextAt) return false;
	const expected = livePlaybackPosition(prev, now);
	const reported = Number(next.position) || 0;
	return Math.abs(reported - expected) > 1.4;
}

/** Time constant for the lyric-stack lerp. After ~3τ the offset has settled
 *  (~840ms), so line changes and instrumental rests ease instead of jumping. */
export const STACK_EASE_TAU_SEC = 0.22;

/** Exponential ease toward `target`. One rAF step; `tauSec` is the time
 *  constant (63% of the remaining gap per τ). Snaps when dt or tau is 0. */
export function easeToward(current, target, dtSec, tauSec) {
	const from = Number(current);
	const to = Number(target);
	if (!Number.isFinite(to)) return Number.isFinite(from) ? from : 0;
	if (!Number.isFinite(from)) return to;
	if (!(dtSec > 0) || !(tauSec > 0)) return to;
	if (Math.abs(to - from) < 0.15) return to;
	return from + (to - from) * (1 - Math.exp(-dtSec / tauSec));
}

// A gap at least this long between one line's clock and the next reads as
// an instrumental break rather than just an unhurried lyric. Breaths shorter
// than this stay on the finished line instead of flipping to dots.
export const INSTRUMENTAL_GAP_SEC = 2.5;
/** Karaoke highlight leads the transport clock by this much so the fill
 *  lands on the beat instead of a hair behind it. Progress/time stay on the
 *  real sample; only the lyric stack uses the lead. */
export const LYRIC_LEAD_SEC = 0.1;
/** Line-only LRC has no word `end`. Hold the line this long before a long
 *  wait until the next stamp can count as a rest. */
const DEFAULT_LINE_HOLD_SEC = 2.4;
/** When the file has no next line and no track length, sweep dots across
 *  this window then hold them lit through the outro. */
const DEFAULT_OUTRO_SWEEP_SEC = 12;

/** Clock when a line finishes being sung. Blank markers sit at their stamp.
 *  Word-timed lines use the last word's end; line-only rows get a short hold
 *  so a long instrumental after them can still become dots. */
export function lineEndClock(line, nextLineStart) {
	if (!line) return 0;
	if (!line.text) return Number(line.time) || 0;
	const bgEnd = lastBackgroundEnd(line, nextLineStart);
	const words = line.words;
	if (Array.isArray(words) && words.length) {
		return Math.max(
			wordEndTime(words, words.length - 1, line.end, nextLineStart),
			bgEnd
		);
	}
	const start = Number(line.time) || 0;
	const lineEnd = Number(line.end);
	if (Number.isFinite(lineEnd) && lineEnd > start) {
		if (lineEnd - start >= INSTRUMENTAL_GAP_SEC) {
			return Math.max(start + DEFAULT_LINE_HOLD_SEC, bgEnd);
		}
		return Math.max(lineEnd, bgEnd);
	}
	return Math.max(start + DEFAULT_LINE_HOLD_SEC, bgEnd);
}

function restEndFromLength(start, length) {
	const len = Number(length) || 0;
	if (len > start + INSTRUMENTAL_GAP_SEC) return len;
	return start + DEFAULT_OUTRO_SWEEP_SEC;
}

/** The {start, end} span of an instrumental break at `lines[index]`, or
 *  null if that slot isn't one. Only a line the lyrics source stamped with
 *  no text (a blank timed marker - what LRC instrumental cues look like)
 *  counts. Community TTML/YRC often omit those markers; `instrumentalRest`
 *  covers intro / between-line / outro rests without a blank row. */
export function instrumentalGap(lines, index, length = 0) {
	if (!Array.isArray(lines) || index < 0 || index >= lines.length) return null;
	const line = lines[index];
	if (line.text) return null;
	const start = Number(line.time) || 0;
	const next = lines[index + 1];
	const end = next ? Number(next.time) || 0 : restEndFromLength(start, length);
	if (end - start < INSTRUMENTAL_GAP_SEC) return null;
	return { start, end };
}

/** Rest currently playing at `position`: intro before the first line, a long
 *  gap after a sung line (even with no blank marker), a blank LRC cue, or
 *  the outro after the last line. `afterIndex` is -1 for intro, else the
 *  lyric index the rest belongs to. `blank` is true when that index is the
 *  empty marker itself (render dots on that row instead of injecting one). */
export function instrumentalRest(lines, position, length = 0) {
	if (!Array.isArray(lines) || !lines.length) return null;
	const t = Number(position) || 0;
	const firstStart = Number(lines[0].time) || 0;
	if (t < firstStart && firstStart >= INSTRUMENTAL_GAP_SEC) {
		return { start: 0, end: firstStart, afterIndex: -1, blank: false };
	}

	const started = activeLyricIndex(lines, t);
	if (started < 0) return null;

	const line = lines[started];
	const next = lines[started + 1];

	if (!line.text) {
		const gap = instrumentalGap(lines, started, length);
		if (gap) return { ...gap, afterIndex: started, blank: true };
		return null;
	}

	const sungEnd = lineEndClock(line, next?.time);
	if (t < sungEnd) return null;

	if (next && !next.text) {
		const blankGap = instrumentalGap(lines, started + 1, length);
		if (blankGap && t >= blankGap.start && t < blankGap.end) {
			return { ...blankGap, afterIndex: started + 1, blank: true };
		}
		const blankStart = Number(next.time) || 0;
		if (blankStart - sungEnd >= INSTRUMENTAL_GAP_SEC && t < blankStart) {
			return { start: sungEnd, end: blankStart, afterIndex: started, blank: false };
		}
		return null;
	}

	const restEnd = next ? Number(next.time) || 0 : restEndFromLength(sungEnd, length);
	if (restEnd - sungEnd < INSTRUMENTAL_GAP_SEC) return null;
	if (next && t >= restEnd) return null;
	return { start: sungEnd, end: restEnd, afterIndex: started, blank: false };
}

/** Opacity (0..1) for the three-dot instrumental indicator at `lines[index]`
 *  given the current playback `position` - rises gradually across the gap
 *  and reaches full brightness right as the break ends, rather than
 *  snapping in like a lyric line does. */
export function instrumentalDotsOpacity(lines, index, position, length = 0) {
	return instrumentalDotsOpacityFromGap(instrumentalGap(lines, index, length), position);
}

export function instrumentalDotsOpacityFromGap(gap, position) {
	if (!gap) return 0;
	const t = Number(position) || 0;
	if (t <= gap.start) return 0;
	if (t >= gap.end) return 1;
	const span = gap.end - gap.start;
	if (!(span > 0)) return 0;
	return (t - gap.start) / span;
}

/** Per-dot brightness (0..1 each) for the instrumental indicator, the way
 *  Apple Music's does it: the dots light up one at a time in sequence as the
 *  gap elapses, rather than fading in together - and because they're keyed
 *  off the gap's actual {start, end} span, a long instrumental break sweeps
 *  slowly and a short one (still >= the instrumental-gap threshold) sweeps
 *  fast, instead of every gap animating at the same fixed rate. */
export function instrumentalDotStates(lines, index, position, dotCount = 3, length = 0) {
	return instrumentalDotStatesFromGap(instrumentalGap(lines, index, length), position, dotCount);
}

export function instrumentalDotStatesFromGap(gap, position, dotCount = 3) {
	if (!gap) return new Array(dotCount).fill(0);
	const t = Number(position) || 0;
	const span = gap.end - gap.start;
	if (!(span > 0)) return new Array(dotCount).fill(0);
	const progress = Math.max(0, Math.min(1, (t - gap.start) / span));
	return Array.from({ length: dotCount }, (_, i) => {
		const segStart = i / dotCount;
		const segEnd = (i + 1) / dotCount;
		if (progress <= segStart) return 0;
		if (progress >= segEnd) return 1;
		return (progress - segStart) / (segEnd - segStart);
	});
}
