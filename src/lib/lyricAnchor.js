/** Cross-checks two timings of the same lyrics. LRCLIB's `/api/get` with a
 *  duration returns a human-stamped line file for this exact release, so its
 *  line clocks are a trustworthy reference: a karaoke file from another
 *  release can be shifted onto it, and an on-device alignment that wandered
 *  off can be pulled back line by line. */

const LOOKAHEAD = 6;

function letters(text) {
	return String(text || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** In-order pairs `[i, j]` of lines with the same letters in `a` and `b`. */
export function matchLyricLines(a, b) {
	const pairs = [];
	if (!Array.isArray(a) || !Array.isArray(b)) return pairs;
	let j = 0;
	for (let i = 0; i < a.length && j < b.length; i++) {
		const key = letters(a[i]?.text);
		if (!key) continue;
		for (let k = j; k < b.length && k < j + LOOKAHEAD; k++) {
			if (letters(b[k]?.text) === key) {
				pairs.push([i, k]);
				j = k + 1;
				break;
			}
		}
	}
	return pairs;
}

function median(values) {
	if (!values.length) return 0;
	const sorted = [...values].sort((x, y) => x - y);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** `{ offset, spread, pairs }`: median (reference - lines) start delta and
 *  the median absolute deviation around it. */
export function lyricOffset(lines, reference) {
	const pairs = matchLyricLines(lines, reference);
	const deltas = pairs.map(([i, j]) => (Number(reference[j].time) || 0) - (Number(lines[i].time) || 0));
	const offset = median(deltas);
	const spread = median(deltas.map((d) => Math.abs(d - offset)));
	return { offset, spread, pairs: pairs.length };
}

function shiftPart(part, delta) {
	if (!part || typeof part !== 'object') return part;
	const next = { ...part, time: Math.max(0, (Number(part.time) || 0) + delta) };
	if (Number.isFinite(Number(part.end))) next.end = Math.max(0, Number(part.end) + delta);
	if (Array.isArray(part.words)) next.words = part.words.map((w) => shiftPart(w, delta));
	if (Array.isArray(part.background)) next.background = part.background.map((bg) => shiftPart(bg, delta));
	return next;
}

export function shiftLyricLines(lines, delta) {
	if (!Array.isArray(lines) || !delta) return lines;
	return lines.map((line) => shiftPart(line, delta));
}

const MIN_PAIRS = 4;
const MIN_SHIFT_SEC = 0.35;
const MAX_SPREAD_SEC = 0.6;

/** Shifts `lines` onto `reference` when they agree line for line but sit a
 *  constant offset apart (another release's intro, a padded upload). Leaves
 *  them alone when they already agree or disagree in structure. */
export function reconcileLyricOffset(lines, reference) {
	if (!Array.isArray(lines) || !Array.isArray(reference)) return lines;
	const { offset, spread, pairs } = lyricOffset(lines, reference);
	if (pairs < MIN_PAIRS || Math.abs(offset) < MIN_SHIFT_SEC || spread > MAX_SPREAD_SEC) return lines;
	return shiftLyricLines(lines, offset);
}

/** Tolerance before an aligned line counts as lost. Human LRC stamps land
 *  within a few hundred ms of the first word; an aligner that is seconds off
 *  matched the wrong phrase. */
export const ANCHOR_TOLERANCE_SEC = 2;

/** Keeps each aligned line whose start agrees with the reference; a line
 *  that drifted past the tolerance is moved back onto the reference clock
 *  with its word spacing kept. Lines the reference does not have stay. */
export function anchorAlignedLines(aligned, reference, tolerance = ANCHOR_TOLERANCE_SEC) {
	if (!Array.isArray(aligned) || !Array.isArray(reference) || !reference.length) return aligned;
	const pairs = matchLyricLines(aligned, reference);
	if (!pairs.length) return aligned;
	const out = aligned.slice();
	let changed = false;
	for (const [i, j] of pairs) {
		const delta = (Number(reference[j].time) || 0) - (Number(aligned[i].time) || 0);
		if (Math.abs(delta) <= tolerance) continue;
		const moved = shiftPart(aligned[i], delta);
		const nextRef = reference[j + 1];
		const limit = Number(nextRef?.time);
		if (Array.isArray(moved.words) && moved.words.length && Number.isFinite(limit) && limit > moved.time) {
			const last = moved.words[moved.words.length - 1];
			const lastEnd = Number(last.end) || Number(last.time) || moved.time;
			if (lastEnd > limit) {
				const scale = (limit - moved.time) / Math.max(0.01, lastEnd - moved.time);
				const squash = (t) => moved.time + (t - moved.time) * scale;
				moved.words = moved.words.map((w) => ({
					...w,
					time: squash(Number(w.time) || moved.time),
					...(Number.isFinite(Number(w.end)) ? { end: squash(Number(w.end)) } : {})
				}));
				moved.end = limit;
			}
		}
		out[i] = moved;
		changed = true;
	}
	if (!changed) return aligned;
	return out.sort((x, y) => (Number(x.time) || 0) - (Number(y.time) || 0));
}
