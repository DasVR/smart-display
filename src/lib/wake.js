/**
 * The wall waking up.
 *
 * From power on to the dashboard, one thing is on screen: a small standby
 * light breathing in the middle of a black screen. The boot splash
 * (scripts/boot/plymouth), the browser's boot page (static/boot.html) and the
 * wall's own page (the cover in src/app.html) all draw the same light in the
 * same place, so the hand-offs between them don't show.
 *
 * When the wall is ready (fonts in, first weather, a painted frame), it opens
 * its eyes: the light brightens and stretches into a thin seam of light, the
 * two halves of the black cover part like eyelids, and the dashboard settles
 * into place underneath. About a second, all of it transform and opacity
 * (compositor only, so a busy main thread can't stutter it). With reduced
 * motion it's a short fade.
 *
 * `awake` flips the moment the eyes start to open; the clock's digits wait
 * for it, so their spin-up plays where you can see it (RollingDigit.svelte).
 */

import { get, writable } from 'svelte/store';

const booting = () => typeof document !== 'undefined' && document.documentElement.classList.contains('wall-booting');

export const awake = writable(!booting());

// timings (ms), on the GIF-like grid the rest of the wall's motion uses
export const WAKE = {
	brighten: 140,
	seamAt: 100,
	seam: 380,
	lidsAt: 300,
	lids: 760,
	settle: 900
};

const ENTER = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EXPO = 'cubic-bezier(0.19, 1, 0.22, 1)';
const LIDS = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Run fn once the wall is awake (now, if it already is). Returns a cancel. */
export function whenAwake(fn) {
	if (get(awake)) {
		fn();
		return () => {};
	}
	let done = false;
	let unsub = () => {};
	unsub = awake.subscribe((v) => {
		if (v && !done) {
			done = true;
			queueMicrotask(() => unsub());
			fn();
		}
	});
	return () => {
		done = true;
		unsub();
	};
}

/** The marks the boot page passed along (`?boot=<kiosk>.<reached>`), or {}. */
export function bootMarksFrom(search = '') {
	const raw = new URLSearchParams(search).get('boot') || '';
	const [kiosk, reached] = raw.split('.').map(Number);
	const ok = (n) => Number.isFinite(n) && n > 1e12;
	return { ...(ok(kiosk) ? { kiosk } : {}), ...(ok(reached) ? { reached } : {}) };
}

/** Resolve after `ready` settles or `cap` ms, whichever is first, then two frames (so it's painted). */
export function readyOrCap(ready, cap = 2500) {
	return Promise.race([Promise.resolve(ready).catch(() => {}), new Promise((r) => setTimeout(r, cap))]).then(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	);
}

/**
 * Open the wall's eyes. `root` is the dashboard (it settles into place);
 * the cover is #wall-boot from src/app.html. Resolves when it's done.
 */
export async function wake({ root = null, reduced = false } = {}) {
	const cover = typeof document !== 'undefined' ? document.getElementById('wall-boot') : null;
	if (!cover || !booting()) {
		cover?.remove();
		awake.set(true);
		return;
	}
	const light = cover.querySelector('.wall-boot-light');
	const lids = [...cover.querySelectorAll('.wall-boot-lid')];
	const run = [];
	const anim = (el, frames, opts) => {
		if (!el?.animate) return;
		const a = el.animate(frames, { fill: 'forwards', ...opts });
		run.push(a.finished.catch(() => {}));
	};

	cover.classList.add('waking');
	awake.set(true);

	if (reduced) {
		anim(cover, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out' });
	} else {
		// the light stops breathing and brightens, then draws out into a seam
		const width = Math.max(window.innerWidth, 800);
		anim(light, [{ opacity: 0.85, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.25)' }], { duration: WAKE.brighten, easing: ENTER });
		anim(
			light,
			[
				{ opacity: 1, transform: 'scale(1.25)' },
				{ opacity: 1, transform: `scale(${(width * 0.45) / 10}, 0.22)`, offset: 0.6 },
				{ opacity: 0, transform: `scale(${width / 10}, 0.1)` }
			],
			{ duration: WAKE.seam + WAKE.lids * 0.5, delay: WAKE.seamAt + WAKE.brighten, easing: EXPO }
		);
		// the lids part from the seam
		lids.forEach((lid, i) =>
			anim(lid, [{ transform: 'translateY(0)' }, { transform: `translateY(${i ? '' : '-'}101%)` }], {
				duration: WAKE.lids,
				delay: WAKE.lidsAt + WAKE.brighten,
				easing: LIDS
			})
		);
		// the dashboard settles in as they open
		if (root?.animate) {
			const a = root.animate([{ transform: 'scale(1.035)', opacity: 0.6 }, { transform: 'scale(1)', opacity: 1 }], {
				duration: WAKE.settle,
				delay: WAKE.lidsAt + WAKE.brighten,
				easing: EXPO
			});
			// let go of the transform afterwards: it would pin position:fixed children
			run.push(a.finished.catch(() => {}));
		}
	}
	await Promise.all(run);
	cover.remove();
	document.documentElement.classList.remove('wall-booting');
}
