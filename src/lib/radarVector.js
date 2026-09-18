/**
 * Turns the radar raster into vector regions instead of a stretched bitmap.
 * RainViewer tops out at z7, so a city zoom would otherwise blow each source
 * pixel up to ~12 CSS px. `extractField` classifies each mosaic pixel against
 * RainViewer's Universal Blue rain/snow palette (scheme 2), then traces one
 * contour per rain type so drizzle, light rain, heavy rain, and hail keep
 * their own colors instead of averaging into one cyan blob. `lerpFields` /
 * `lerpColor` blend two frames so cells grow, shrink, split, and merge.
 */

/** Universal Blue rain stops (RainViewer scheme 2). dBZ is the official
 *  table; RGB is the tile color for that type. */
export const RADAR_RAIN_PALETTE = [
	{ dbz: 10, r: 206, g: 192, b: 135 }, // drizzle / virga
	{ dbz: 15, r: 136, g: 221, b: 238 }, // light rain
	{ dbz: 20, r: 0, g: 163, b: 224 }, // light-moderate
	{ dbz: 25, r: 0, g: 119, b: 170 }, // moderate
	{ dbz: 30, r: 0, g: 85, b: 136 }, // moderate-heavy
	{ dbz: 35, r: 255, g: 238, b: 0 }, // heavy
	{ dbz: 40, r: 255, g: 170, b: 0 }, // very heavy
	{ dbz: 45, r: 255, g: 68, b: 0 }, // intense
	{ dbz: 50, r: 193, g: 0, b: 0 }, // severe
	{ dbz: 55, r: 255, g: 170, b: 255 }, // extreme
	{ dbz: 60, r: 255, g: 119, b: 255 }, // violent
	{ dbz: 65, r: 255, g: 255, b: 255 } // hail
];

/** Snow colors from the same table, used only to classify tiles (`1_1.png`
 *  paints snow separately). Intensity still follows dBZ. */
export const RADAR_SNOW_PALETTE = [
	{ dbz: 10, r: 191, g: 255, b: 255 },
	{ dbz: 20, r: 127, g: 191, b: 255 },
	{ dbz: 30, r: 79, g: 143, b: 255 },
	{ dbz: 40, r: 47, g: 111, b: 255 },
	{ dbz: 50, r: 15, g: 79, b: 255 },
	{ dbz: 60, r: 0, g: 47, b: 255 }
];

const RADAR_MATCH_PALETTE = [...RADAR_RAIN_PALETTE, ...RADAR_SNOW_PALETTE];

const DBZ_MIN = 8;
const DBZ_MAX = 65;

export function dbzToIntensity(dbz) {
	return Math.max(0, Math.min(1, (dbz - DBZ_MIN) / (DBZ_MAX - DBZ_MIN)));
}

/** Slight see-through so the map reads under the rain. Heavier types sit a
 *  bit more solid, but nothing is fully opaque. */
export function rainFillAlpha(dbz) {
	const t = dbzToIntensity(dbz);
	return 0.64 + 0.22 * t;
}

export const RADAR_THRESHOLDS = RADAR_RAIN_PALETTE.map((p) => dbzToIntensity(p.dbz));

export const RADAR_FALLBACK_COLORS = RADAR_RAIN_PALETTE.map((p) => `rgb(${p.r}, ${p.g}, ${p.b})`);

export const RADAR_BAND_ALPHAS = RADAR_RAIN_PALETTE.map((p) => rainFillAlpha(p.dbz));

/** Light corner-cut so marching-squares facets do not read as a mesh, without
 *  the two-iteration metaball shrink that used to invent blob shapes. */
export const CONTOUR_CHAIKIN_ITERATIONS = 1;

/** Nearest Universal Blue rain or snow stop for a sample RGB. */
export function nearestRadarColor(r, g, b) {
	let best = null;
	let bestD = Infinity;
	for (const swatch of RADAR_MATCH_PALETTE) {
		const dr = r - swatch.r;
		const dg = g - swatch.g;
		const db = b - swatch.b;
		const d = dr * dr + dg * dg + db * db;
		if (d < bestD) {
			bestD = d;
			best = swatch;
		}
	}
	return best;
}

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

function bandOpacitiesFor(thresholds) {
	if (thresholds === RADAR_THRESHOLDS) return RADAR_BAND_ALPHAS.slice();
	const last = Math.max(1, thresholds.length - 1);
	return thresholds.map((_, i) => 0.64 + 0.22 * (i / last));
}

/**
 * Classifies a composited radar frame (`ImageData`-shaped) by RainViewer
 * rain type: each pixel snaps to the nearest Universal Blue stop, the
 * intensity grid follows that stop's dBZ, and each band's fill is the
 * average of pixels of that type (so yellow heavy rain cannot mix into
 * the light-rain cyan band).
 */
export function extractField(imageData, thresholds = RADAR_THRESHOLDS, fallbackColors = RADAR_FALLBACK_COLORS) {
	const { data, width, height } = imageData;
	const n = width * height;
	const alpha = new Float32Array(n);
	const bins = thresholds.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));

	for (let i = 0; i < n; i++) {
		const o = i * 4;
		const a = data[o + 3];
		if (a < 12) {
			alpha[i] = 0;
			continue;
		}
		const match = nearestRadarColor(data[o], data[o + 1], data[o + 2]);
		const intensity = match ? dbzToIntensity(match.dbz) : a / 255;
		alpha[i] = intensity;
		for (let b = thresholds.length - 1; b >= 0; b--) {
			if (intensity >= thresholds[b]) {
				const bin = bins[b];
				bin.r += data[o];
				bin.g += data[o + 1];
				bin.b += data[o + 2];
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

	return { alpha, cols: width, rows: height, colors, opacities: bandOpacitiesFor(thresholds) };
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
