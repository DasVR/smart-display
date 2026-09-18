/**
 * Turns the radar raster into vector regions instead of a stretched bitmap.
 * RainViewer tops out at z7, so a city zoom would otherwise blow each source
 * pixel up to ~12 CSS px. `extractField` reduces a frame's native mosaic to
 * a dense intensity grid (plus a representative color per band, sampled from
 * the real pixels), `marchingSquares` traces those cells, and a light
 * Chaikin pass (or none) keeps the original cell footprint instead of
 * rounding it into a metaball. `lerpFields`/`lerpColor` blend two frames so
 * a transition can re-trace contours - cells grow, shrink, split, and merge
 * instead of cross-fading two rasters in place.
 */

/** Intensity bands (0-1 alpha) contours are traced at, lightest to heaviest.
 *  Dense enough that RainViewer's color steps stay distinct instead of
 *  collapsing into four averaged blobs. */
export const RADAR_THRESHOLDS = [
	0.06, 0.14, 0.22, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86, 0.94
];

/** Used only when a band has no sampled pixels in a given frame (so nothing
 *  using it will actually be visible) - a safe fallback color to avoid an
 *  undefined fillStyle, not a claim about real intensity. */
export const RADAR_FALLBACK_COLORS = [
	'rgb(76, 130, 190)',
	'rgb(70, 150, 180)',
	'rgb(64, 170, 150)',
	'rgb(84, 170, 120)',
	'rgb(140, 180, 80)',
	'rgb(210, 190, 70)',
	'rgb(220, 150, 60)',
	'rgb(210, 110, 55)',
	'rgb(200, 90, 70)',
	'rgb(190, 70, 90)',
	'rgb(180, 50, 120)',
	'rgb(160, 40, 140)'
];

/** Light corner-cut so marching-squares facets do not read as a mesh, without
 *  the two-iteration metaball shrink that used to invent blob shapes. */
export const CONTOUR_CHAIKIN_ITERATIONS = 1;

/** Linearly interpolates the crossing point of `threshold` along the edge
 *  from `pa` (value `va`) to `pb` (value `vb`). Must be called with the same
 *  two corner points/values (same order) from both cells that share an
 *  edge, so the two independent calls produce bit-identical output and
 *  `joinSegments` can match them by coordinate. */
function interpEdge(pa, pb, va, vb, threshold) {
	const span = vb - va;
	const t = Math.abs(span) < 1e-9 ? 0.5 : (threshold - va) / span;
	const ct = t < 0 ? 0 : t > 1 ? 1 : t;
	return [pa[0] + (pb[0] - pa[0]) * ct, pa[1] + (pb[1] - pa[1]) * ct];
}

function keyOf(pt) {
	return `${pt[0].toFixed(4)}:${pt[1].toFixed(4)}`;
}

/** Chains marching-squares edge segments (each `[ptA, ptB]`) into closed
 *  polygons by matching coincident endpoints. Segments that never close
 *  (a contour clipped by the grid's border) are dropped rather than filled
 *  as a bogus shape. */
function joinSegments(segments) {
	const adjacency = new Map();
	const addAdjacency = (key, seg, other) => {
		if (!adjacency.has(key)) adjacency.set(key, []);
		adjacency.get(key).push({ seg, other });
	};
	for (const seg of segments) {
		addAdjacency(keyOf(seg[0]), seg, seg[1]);
		addAdjacency(keyOf(seg[1]), seg, seg[0]);
	}

	const used = new Set();
	const polygons = [];
	for (const seg of segments) {
		if (used.has(seg)) continue;
		used.add(seg);
		const poly = [seg[0], seg[1]];
		const startKey = keyOf(seg[0]);
		let currentKey = keyOf(seg[1]);
		let closed = false;
		for (let guard = 0; guard < segments.length + 1; guard++) {
			if (currentKey === startKey) {
				closed = true;
				break;
			}
			const candidates = adjacency.get(currentKey) || [];
			const next = candidates.find((c) => !used.has(c.seg));
			if (!next) break;
			used.add(next.seg);
			poly.push(next.other);
			currentKey = keyOf(next.other);
		}
		if (closed && poly.length >= 3) {
			poly.pop();
			polygons.push(poly);
		}
	}
	return polygons;
}

/**
 * Traces closed contour polygons where `field >= threshold`, via standard
 * marching squares with linearly-interpolated edge crossings (so contours
 * follow the real gradient between grid samples, not a blocky cell-aligned
 * outline). Points are returned in fractional grid coordinates.
 */
export function marchingSquares(field, cols, rows, threshold) {
	const at = (x, y) => field[y * cols + x];
	const segments = [];

	for (let y = 0; y < rows - 1; y++) {
		for (let x = 0; x < cols - 1; x++) {
			const tl = at(x, y);
			const tr = at(x + 1, y);
			const br = at(x + 1, y + 1);
			const bl = at(x, y + 1);

			let idx = 0;
			if (tl >= threshold) idx |= 8;
			if (tr >= threshold) idx |= 4;
			if (br >= threshold) idx |= 2;
			if (bl >= threshold) idx |= 1;
			if (idx === 0 || idx === 15) continue;

			const pTL = [x, y];
			const pTR = [x + 1, y];
			const pBR = [x + 1, y + 1];
			const pBL = [x, y + 1];
			const top = () => interpEdge(pTL, pTR, tl, tr, threshold);
			const right = () => interpEdge(pTR, pBR, tr, br, threshold);
			const bottom = () => interpEdge(pBL, pBR, bl, br, threshold);
			const left = () => interpEdge(pTL, pBL, tl, bl, threshold);

			switch (idx) {
				case 1:
				case 14:
					segments.push([left(), bottom()]);
					break;
				case 2:
				case 13:
					segments.push([bottom(), right()]);
					break;
				case 3:
				case 12:
					segments.push([left(), right()]);
					break;
				case 4:
				case 11:
					segments.push([top(), right()]);
					break;
				case 6:
				case 9:
					segments.push([top(), bottom()]);
					break;
				case 7:
				case 8:
					segments.push([left(), top()]);
					break;
				case 5: {
					// Ambiguous saddle: resolve by the cell's average value so the
					// choice is at least consistent with the data, not arbitrary.
					if ((tl + tr + br + bl) / 4 >= threshold) {
						segments.push([left(), top()], [bottom(), right()]);
					} else {
						segments.push([top(), right()], [left(), bottom()]);
					}
					break;
				}
				case 10: {
					if ((tl + tr + br + bl) / 4 >= threshold) {
						segments.push([top(), right()], [left(), bottom()]);
					} else {
						segments.push([left(), top()], [bottom(), right()]);
					}
					break;
				}
			}
		}
	}

	return joinSegments(segments);
}

/** Chaikin corner-cutting on a closed polygon: each iteration roughly
 *  doubles the point count and rounds every corner, turning the already
 *  interpolated marching-squares outline into the soft, rounded edge a
 *  metaball blend reads as. */
export function chaikinSmooth(points, iterations = 2) {
	let pts = points;
	for (let iter = 0; iter < iterations; iter++) {
		if (pts.length < 3) break;
		const next = [];
		const n = pts.length;
		for (let i = 0; i < n; i++) {
			const p0 = pts[i];
			const p1 = pts[(i + 1) % n];
			next.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25]);
			next.push([p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
		}
		pts = next;
	}
	return pts;
}

/** Min/max of an intensity grid - lets a caller tell "nothing reaches this
 *  threshold" apart from "the whole visible grid is already past it" (a
 *  storm filling the entire view), since marching squares only finds a
 *  boundary that actually crosses the sampled area and returns nothing for
 *  either extreme. */
export function fieldExtent(field) {
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < field.length; i++) {
		const v = field[i];
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return { min, max };
}

/** Element-wise blend of two same-sized intensity grids. */
export function lerpFields(a, b, t) {
	const out = new Float32Array(a.length);
	for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
	return out;
}

const RGB_RE = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i;

function parseRgb(color) {
	const m = RGB_RE.exec(color || '');
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** Blends two `rgb(...)` color strings. */
export function lerpColor(colorA, colorB, t) {
	const a = parseRgb(colorA);
	const b = parseRgb(colorB);
	const r = Math.round(a[0] + (b[0] - a[0]) * t);
	const g = Math.round(a[1] + (b[1] - a[1]) * t);
	const bl = Math.round(a[2] + (b[2] - a[2]) * t);
	return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * Reduces a composited radar frame's pixels (an object shaped like
 * `ImageData` - `{data, width, height}` with `data` a flat RGBA byte array)
 * to an alpha intensity grid plus one representative color per threshold
 * band, averaged from the real pixels that actually fall in that band -
 * so the fill color is sampled from the source tile, not invented.
 */
export function extractField(imageData, thresholds = RADAR_THRESHOLDS, fallbackColors = RADAR_FALLBACK_COLORS) {
	const { data, width, height } = imageData;
	const n = width * height;
	const alpha = new Float32Array(n);
	const bins = thresholds.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));

	for (let i = 0; i < n; i++) {
		const a = data[i * 4 + 3] / 255;
		alpha[i] = a;
		for (let b = thresholds.length - 1; b >= 0; b--) {
			if (a >= thresholds[b]) {
				const bin = bins[b];
				bin.r += data[i * 4];
				bin.g += data[i * 4 + 1];
				bin.b += data[i * 4 + 2];
				bin.n++;
				break;
			}
		}
	}

	const colors = bins.map((bin, i) =>
		bin.n
			? `rgb(${Math.round(bin.r / bin.n)}, ${Math.round(bin.g / bin.n)}, ${Math.round(bin.b / bin.n)})`
			: fallbackColors[i]
	);

	return { alpha, cols: width, rows: height, colors };
}

/** Upper bound on field rows. High enough that a ~192-col square radar
 *  (one sample per RainViewer source pixel at city zoom) is not clamped. */
export const FIELD_MAX_ROWS = 256;

/** Chooses a grid size close to `targetCols` whose aspect matches the given
 *  world-space bounds, so cells stay roughly square regardless of the
 *  viewport's own aspect ratio. */
export function fieldGridSize(worldW, worldH, targetCols = 192, minRows = 24, maxRows = FIELD_MAX_ROWS) {
	const aspect = worldW / worldH;
	const cols = targetCols;
	let rows = Math.round(cols / aspect);
	if (!Number.isFinite(rows) || rows <= 0) rows = cols;
	rows = Math.max(minRows, Math.min(maxRows, rows));
	return { cols, rows };
}
