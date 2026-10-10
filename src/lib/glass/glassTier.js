import { writable } from 'svelte/store';
import { createFrameGovernor } from './frameGovernor.js';

/** Glass quality chosen from frame times: 'refract' | 'blur' | 'flat'. */
export const glassTier = writable('refract');

/** Watches frame times with requestAnimationFrame and steps `glassTier`
 *  down when frames slip, back up once they recover. Returns a stop
 *  function. */
export function startGlassGovernor(opts) {
	if (typeof window === 'undefined') return () => {};
	const gov = createFrameGovernor(opts);
	let last = 0;
	let raf = 0;
	let shown = gov.tier;
	glassTier.set(shown);
	const tick = (now) => {
		if (last) {
			const tier = gov.sample(now - last);
			if (tier !== shown) {
				shown = tier;
				glassTier.set(tier);
			}
		}
		last = now;
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);
	return () => cancelAnimationFrame(raf);
}
