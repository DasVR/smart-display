// Glass quality tiers driven by frame time. The idea (step down a tier when
// frames slip, climb back slowly once they recover) comes from
// rbayuokt/expo-adaptive-glass (MIT); the code here is our own.
//
// Tiers, best first:
//   refract  live-backdrop lens (SVG displacement) plus a light blur
//   blur     the plain frosted blur
//   flat     no backdrop filter at all

export const GLASS_TIERS = ['refract', 'blur', 'flat'];

/**
 * @param {{ slowMs?: number, fastMs?: number, downAfterMs?: number, upAfterMs?: number, alpha?: number, start?: string }} [opts]
 *   slowMs:      smoothed frame time above which frames count as slipping
 *   fastMs:      smoothed frame time below which frames count as healthy
 *   downAfterMs: how long frames must slip before stepping down
 *   upAfterMs:   how long frames must be healthy before stepping back up
 */
export function createFrameGovernor(opts = {}) {
	const slowMs = opts.slowMs ?? 24;
	const fastMs = opts.fastMs ?? 18;
	const downAfterMs = opts.downAfterMs ?? 2000;
	const upAfterMs = opts.upAfterMs ?? 15000;
	const alpha = opts.alpha ?? 0.1;
	let level = Math.max(0, GLASS_TIERS.indexOf(opts.start ?? 'refract'));
	let ema = 1000 / 60;
	let slowFor = 0;
	let fastFor = 0;

	return {
		/** Feed one frame's duration in ms; returns the current tier. */
		sample(dtMs) {
			// a hidden tab or a breakpoint is not a slow frame
			if (!(dtMs > 0) || dtMs > 250) return GLASS_TIERS[level];
			ema += (dtMs - ema) * alpha;
			if (ema > slowMs) {
				slowFor += dtMs;
				fastFor = 0;
			} else if (ema < fastMs) {
				fastFor += dtMs;
				slowFor = 0;
			} else {
				slowFor = 0;
				fastFor = 0;
			}
			if (slowFor >= downAfterMs && level < GLASS_TIERS.length - 1) {
				level++;
				slowFor = 0;
			} else if (fastFor >= upAfterMs && level > 0) {
				level--;
				fastFor = 0;
			}
			return GLASS_TIERS[level];
		},
		get tier() {
			return GLASS_TIERS[level];
		},
		get frameMs() {
			return ema;
		}
	};
}

/** The tier actually used: the governor's, capped by the display quality the
 *  load arbiter chose (eco and frozen never refract). */
export function effectiveGlassTier(governed, displayQuality) {
	if (displayQuality === 'frozen') return 'flat';
	if (displayQuality === 'eco') return governed === 'flat' ? 'flat' : 'blur';
	return GLASS_TIERS.includes(governed) ? governed : 'blur';
}
