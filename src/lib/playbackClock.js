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

/** Clock when `words[index]` finishes. Prefers an explicit `end` from
 *  karaoke sources (TTML/YRC/KRC). Otherwise the next word's start, a tight
 *  `lineEndTime`, or a short default — never the start of a far-away next
 *  line, which used to stretch the last character through the rest. */
export function wordEndTime(words, index, lineEndTime) {
	if (!Array.isArray(words) || index < 0 || index >= words.length) return 0;
	const start = Number(words[index].time) || 0;
	const explicit = Number(words[index].end);
	if (Number.isFinite(explicit) && explicit > start) return explicit;
	if (index + 1 < words.length) {
		const next = Number(words[index + 1].time) || 0;
		if (next > start) return next;
	}
	const lineEnd = Number(lineEndTime);
	if (Number.isFinite(lineEnd) && lineEnd > start && lineEnd - start <= MAX_INFERRED_LAST_WORD_SEC) {
		return lineEnd;
	}
	return start + DEFAULT_WORD_SPAN_SEC;
}

/** True once playback has passed the last sung clock on this line. Blank
 *  instrumental markers never count — those stay "on" so the dots can run. */
export function lineSungThrough(line, position) {
	if (!line?.text) return false;
	const t = Number(position) || 0;
	const words = line.words;
	if (Array.isArray(words) && words.length) {
		return t >= wordEndTime(words, words.length - 1, line.end);
	}
	const lineEnd = Number(line.end);
	if (Number.isFinite(lineEnd) && lineEnd > (Number(line.time) || 0)) return t >= lineEnd;
	return false;
}

/** Index of the line currently being sung, or -1 when the last word has
 *  already finished and the next line has not started yet (the lyric stack
 *  goes dark across that rest instead of holding the last character). */
export function singingLyricIndex(lines, position) {
	const idx = activeLyricIndex(lines, position);
	if (idx < 0) return -1;
	if (lineSungThrough(lines[idx], position)) return -1;
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
export function wordProgress(words, index, position, lineEndTime) {
	if (!Array.isArray(words) || index < 0 || index >= words.length) return 0;
	const start = Number(words[index].time) || 0;
	const span = wordSpanSec(words, index, lineEndTime);
	const t = Number(position) || 0;
	return Math.min(1, Math.max(0, (t - start) / span));
}

/** How long `words[index]` is actually sung. */
export function wordSpanSec(words, index, lineEndTime) {
	if (!Array.isArray(words) || index < 0 || index >= words.length) return DEFAULT_WORD_SPAN_SEC;
	const start = Number(words[index].time) || 0;
	const end = wordEndTime(words, index, lineEndTime);
	return end > start ? end - start : DEFAULT_WORD_SPAN_SEC;
}

/** Held notes (Cider / Apple Music letter-float): longer than a spoken
 *  syllable. Typical karaoke words sit around 0.3-0.55s; a held "you"
 *  or last chorus word runs past this. */
export const HELD_WORD_SEC = 0.78;

export function isHeldWord(words, index, lineEndTime, threshold = HELD_WORD_SEC) {
	return wordSpanSec(words, index, lineEndTime) >= threshold;
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
	const expected = livePlaybackPosition(prev, now);
	const reported = Number(next.position) || 0;
	return Math.abs(reported - expected) > 1.4;
}

// A gap at least this long between one line's clock and the next reads as
// an instrumental break rather than just an unhurried lyric.
const INSTRUMENTAL_GAP_SEC = 5;

/** The {start, end} span of an instrumental break at `lines[index]`, or
 *  null if that slot isn't one. Only a line the lyrics source stamped with
 *  no text (a blank timed marker - what LRC instrumental cues look like)
 *  counts; a real lyric line followed by a long rest keeps showing its own
 *  text instead of turning into dots. */
export function instrumentalGap(lines, index) {
	if (!Array.isArray(lines) || index < 0 || index >= lines.length) return null;
	const line = lines[index];
	const next = lines[index + 1];
	if (!next || line.text) return null;
	const start = Number(line.time) || 0;
	const end = Number(next.time) || 0;
	if (end - start < INSTRUMENTAL_GAP_SEC) return null;
	return { start, end };
}

/** Opacity (0..1) for the three-dot instrumental indicator at `lines[index]`
 *  given the current playback `position` - rises gradually across the gap
 *  and reaches full brightness right as the break ends, rather than
 *  snapping in like a lyric line does. */
export function instrumentalDotsOpacity(lines, index, position) {
	const gap = instrumentalGap(lines, index);
	if (!gap) return 0;
	const t = Number(position) || 0;
	if (t <= gap.start) return 0;
	if (t >= gap.end) return 1;
	return (t - gap.start) / (gap.end - gap.start);
}

/** Per-dot brightness (0..1 each) for the instrumental indicator, the way
 *  Apple Music's does it: the dots light up one at a time in sequence as the
 *  gap elapses, rather than fading in together - and because they're keyed
 *  off the gap's actual {start, end} span, a long instrumental break sweeps
 *  slowly and a short one (still >= the instrumental-gap threshold) sweeps
 *  fast, instead of every gap animating at the same fixed rate. */
export function instrumentalDotStates(lines, index, position, dotCount = 3) {
	const gap = instrumentalGap(lines, index);
	if (!gap) return new Array(dotCount).fill(0);
	const t = Number(position) || 0;
	const progress = Math.max(0, Math.min(1, (t - gap.start) / (gap.end - gap.start)));
	return Array.from({ length: dotCount }, (_, i) => {
		const segStart = i / dotCount;
		const segEnd = (i + 1) / dotCount;
		if (progress <= segStart) return 0;
		if (progress >= segEnd) return 1;
		return (progress - segStart) / (segEnd - segStart);
	});
}
