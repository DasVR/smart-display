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
	if (!track.playing || !sampledAt) return frozen;
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
 *  the next word's clock, or to `lineEndTime` (the next line's start) for a
 *  line's last word, falling back to a short default so a lone word still
 *  animates instead of filling instantly. */
export function wordProgress(words, index, position, lineEndTime) {
	if (!Array.isArray(words) || index < 0 || index >= words.length) return 0;
	const start = Number(words[index].time) || 0;
	const next = index + 1 < words.length ? Number(words[index + 1].time) : Number(lineEndTime) || 0;
	const span = next > start ? next - start : 0.6;
	const t = Number(position) || 0;
	return Math.min(1, Math.max(0, (t - start) / span));
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
