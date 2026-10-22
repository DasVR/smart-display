/**
 * The arithmetic behind DitherMeter.svelte: which pixels of a bar are lit.
 * A cell at `pos` (0 at the bar's start, 1 at its end) is lit when the level
 * reaches it, with a soft edge `band` wide where a 4 × 4 Bayer matrix decides
 * pixel by pixel. A level change moves that edge, so the bar dissolves rather
 * than slides. tests/dither-meter.test.mjs.
 */

export const BAYER4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5]
];

/** The Bayer threshold for a cell, in 0..1. */
export function bayer(x, y) {
	return (BAYER4[y & 3][x & 3] + 0.5) / 16;
}

/** Is the cell at (x, y), `pos` along the bar, lit at `level` (0..1)? */
export function ditherLit(x, y, pos, level, band = 0.06) {
	if (level <= 0) return false;
	// 1 well inside the level, 0 well past it, a ramp across the edge
	const k = Math.max(0, Math.min(1, (level - pos) / Math.max(band, 1e-6) + 0.5));
	return k > bayer(x, y);
}

/** The colour token for a level: calm until it's busy, warm when it's pegged. */
export function meterTone(tone, value) {
	if (tone !== 'auto') return tone;
	const v = Number(value) || 0;
	return v >= 85 ? 'warn' : v >= 60 ? 'scan' : 'ok';
}
