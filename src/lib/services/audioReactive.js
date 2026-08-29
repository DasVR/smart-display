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
	const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * beatHz)), playing ? 10 : 3);
	const breathe = 0.5 + 0.5 * Math.sin(t * 0.42);
	const bass = playing
		? 0.22 + beat * 0.72 + breathe * 0.08
		: 0.10 + breathe * 0.10 + beat * 0.06;

	const bins = new Array(32);
	for (let i = 0; i < 32; i++) {
		const falloff = 1 - i / 40;
		const wobble =
			0.10 * Math.sin(t * 1.4 + i * 0.45) +
			0.07 * Math.sin(t * 0.55 + i * 0.19) +
			0.05 * Math.sin(t * 2.1 + i * 0.8);
		const kick = i < 6 ? beat * (0.55 - i * 0.06) : beat * 0.08;
		bins[i] = Math.min(1, Math.max(0.04, (0.12 + wobble) * falloff + kick));
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
