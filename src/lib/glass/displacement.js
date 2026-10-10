// Liquid-glass lens maps. The technique (a rounded-rect SDF turned into an
// SVG feDisplacementMap that refracts the live backdrop) follows
// samasante/liquid-glass (MIT); this is a re-implementation, not the package.
//
// Each pixel's displacement points along the inward edge normal, scaled by the
// slope of a convex "squircle" bezel: steep at the rim, flat in the middle, so
// the centre of the glass shows the backdrop undistorted and the edge bends it
// like the thick lip of a lens.

/** Signed distance from (px, py) to a rounded rect centred at the origin with
 *  half-size (hw, hh) and corner radius r. Negative inside. */
export function sdRoundRect(px, py, hw, hh, r) {
	const qx = Math.abs(px) - hw + r;
	const qy = Math.abs(py) - hh + r;
	const ox = Math.max(qx, 0);
	const oy = Math.max(qy, 0);
	return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
}

/** Height of the convex squircle bezel at t (0 = rim, 1 = where the flat top
 *  starts). */
export function bezelHeight(t) {
	const c = Math.min(Math.max(t, 0), 1);
	return Math.pow(1 - Math.pow(1 - c, 4), 0.25);
}

/** Slope of the bezel, normalised so the rim is 1 and the flat top is 0.
 *  Analytic derivative of bezelHeight, which is infinite at t = 0, so it is
 *  sampled a hair inside the rim and divided by that value. */
const SLOPE_T0 = 0.02;
function rawSlope(t) {
	const c = Math.min(Math.max(t, SLOPE_T0), 1);
	const a = 1 - Math.pow(1 - c, 4);
	if (a <= 0) return 0;
	return Math.pow(a, -0.75) * Math.pow(1 - c, 3);
}
const SLOPE_MAX = rawSlope(SLOPE_T0);
export function bezelSlope(t) {
	if (t >= 1) return 0;
	return rawSlope(t) / SLOPE_MAX;
}

/**
 * RGBA pixels for an feDisplacementMap: R carries x and G carries y, 128 is
 * no displacement. Outside the shape is neutral.
 *
 * @param {number} width  map width in px
 * @param {number} height map height in px
 * @param {{ radius?: number, bezel?: number }} [opts] corner radius and how
 *   far in from the edge the lens curves, both in px
 * @returns {Uint8ClampedArray}
 */
export function displacementPixels(width, height, opts = {}) {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const hw = w / 2;
	const hh = h / 2;
	const radius = Math.min(opts.radius ?? 24, hw, hh);
	const bezel = Math.max(1, Math.min(opts.bezel ?? 18, hw, hh));
	const out = new Uint8ClampedArray(w * h * 4);
	const e = 0.5;
	for (let y = 0; y < h; y++) {
		const py = y + 0.5 - hh;
		for (let x = 0; x < w; x++) {
			const px = x + 0.5 - hw;
			const i = (y * w + x) * 4;
			out[i + 2] = 128;
			out[i + 3] = 255;
			const d = sdRoundRect(px, py, hw, hh, radius);
			const inset = -d;
			if (inset < 0 || inset >= bezel) {
				out[i] = 128;
				out[i + 1] = 128;
				continue;
			}
			// outward normal from the SDF gradient
			let nx = sdRoundRect(px + e, py, hw, hh, radius) - sdRoundRect(px - e, py, hw, hh, radius);
			let ny = sdRoundRect(px, py + e, hw, hh, radius) - sdRoundRect(px, py - e, hw, hh, radius);
			const len = Math.hypot(nx, ny) || 1;
			nx /= len;
			ny /= len;
			const m = bezelSlope(inset / bezel);
			// sample from further in at the rim, so the backdrop bends and
			// compresses toward the edge like a thick convex lip. (Chromium
			// clips a backdrop filter to the element's box, so sampling
			// outward would only find transparent pixels.)
			out[i] = Math.round(128 - nx * m * 127);
			out[i + 1] = Math.round(128 - ny * m * 127);
		}
	}
	return out;
}

/** Cache key for a lens of this geometry; maps are reused across elements. */
export function lensKey(width, height, radius, bezel) {
	return `${Math.round(width)}x${Math.round(height)}r${Math.round(radius)}b${Math.round(bezel)}`;
}
