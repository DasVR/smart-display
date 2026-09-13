import { writable } from 'svelte/store';
import { nowPlaying } from '$lib/stores.js';

export const bassLevel = writable(0.12);
export const spectrum = writable(new Array(32).fill(0.08));

let rafId = 0;
let paused = false;
let unsubPlaying = null;
let playing = false;
let start = performance.now();

function syntheticFrame(t) {
	const beatHz = playing ? 2.15 : 0.35;
	const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * beatHz)), playing ? 6 : 3);
	const breathe = 0.5 + 0.5 * Math.sin(t * 0.42);
	const bass = playing
		? 0.24 + beat * 0.7 + breathe * 0.08
		: 0.10 + breathe * 0.10 + beat * 0.06;

	const bins = new Array(32);
	for (let i = 0; i < 32; i++) {
		// A gentle cosine taper instead of a hard linear falloff keeps every
		// bar in the row visibly moving instead of the top half of the
		// spectrum flatlining near its floor.
		const falloff = playing ? 0.55 + 0.45 * Math.cos((i / 31) * Math.PI * 0.85) : 1 - i / 44;
		const wobble =
			0.14 * Math.sin(t * (1.1 + i * 0.09) + i * 0.6) +
			0.09 * Math.sin(t * (0.4 + i * 0.05) + i * 1.3) +
			0.06 * Math.sin(t * (2.3 + i * 0.03) + i * 0.2);
		// Decays with bin index but never below 0.12 while playing, so the
		// beat reads across the whole bar row, not just the first few bars.
		const kick = playing ? beat * Math.max(0.12, 0.62 - i * 0.028) : beat * 0.05;
		bins[i] = Math.min(1, Math.max(0.06, (0.14 + wobble) * falloff + kick));
	}
	return { bass, bins };
}

function loop() {
	if (paused) return;
	const t = (performance.now() - start) / 1000;
	const frame = syntheticFrame(t);
	bassLevel.set(frame.bass);
	spectrum.set(frame.bins);
	rafId = requestAnimationFrame(loop);
}

export function startAudioReactive() {
	if (typeof window === 'undefined') return () => {};
	unsubPlaying = nowPlaying.subscribe((v) => {
		playing = Boolean(v?.playing);
	});
	paused = false;
	loop();
	return () => {
		paused = true;
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		unsubPlaying?.();
		unsubPlaying = null;
	};
}

export function setAudioPaused(next) {
	if (next && !paused) {
		paused = true;
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		return;
	}
	if (!next && paused) {
		paused = false;
		loop();
	}
}
