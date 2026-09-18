import { writable } from 'svelte/store';
import { nowPlaying } from '$lib/stores.js';

export const bassLevel = writable(0.12);
export const spectrum = writable(new Array(32).fill(0.08));

const BIN_COUNT = 32;
// If a real frame hasn't arrived in this long (server capture start/stop
// lag, a dropped ws message, no parec/pw-record installed), fall back to
// the idle breathing animation instead of freezing on a stale frame.
const STALE_MS = 1500;
// Per-rendered-frame smoothing toward the latest real reading, so ~30fps
// server frames don't look like a stepped animation at 60/120Hz display
// refresh.
const SMOOTH = 0.35;

let rafId = 0;
let paused = false;
let unsubPlaying = null;
let playing = false;
let start = performance.now();

let targetBass = 0.12;
let targetBins = new Array(BIN_COUNT).fill(0.08);
let lastRealFrameAt = 0;

let currentBass = 0.12;
let currentBins = new Array(BIN_COUNT).fill(0.08);

/** Called with real {bass, bins} frames pushed from the server's audio
 *  capture over the websocket. */
export function applyAudioFrame(frame) {
	if (!frame || !Array.isArray(frame.bins)) return;
	targetBass = Number(frame.bass) || 0;
	targetBins = frame.bins;
	lastRealFrameAt = performance.now();
}

function idleFrame(t) {
	const breathe = 0.5 + 0.5 * Math.sin(t * 0.42);
	const bass = 0.1 + breathe * 0.1;
	const bins = new Array(BIN_COUNT);
	for (let i = 0; i < BIN_COUNT; i++) {
		const falloff = 1 - i / 44;
		const wobble = 0.14 * Math.sin(t * (0.4 + i * 0.05) + i * 1.3);
		bins[i] = Math.min(1, Math.max(0.06, (0.14 + wobble) * falloff));
	}
	return { bass, bins };
}

function lerp(a, b, k) {
	return a + (b - a) * k;
}

const PUBLISH_MS = 33;
let lastPublish = 0;
let publishedBass = -1;

function loop() {
	if (paused) return;
	const now = performance.now();
	const t = (now - start) / 1000;
	const hasFreshFrame = playing && now - lastRealFrameAt < STALE_MS;

	if (hasFreshFrame) {
		currentBass = lerp(currentBass, targetBass, SMOOTH);
		for (let i = 0; i < BIN_COUNT; i++) {
			currentBins[i] = lerp(currentBins[i], targetBins[i] ?? 0, SMOOTH);
		}
	} else {
		const idle = idleFrame(t);
		currentBass = lerp(currentBass, idle.bass, SMOOTH);
		for (let i = 0; i < BIN_COUNT; i++) {
			currentBins[i] = lerp(currentBins[i], idle.bins[i], SMOOTH);
		}
	}

	if (now - lastPublish >= PUBLISH_MS) {
		lastPublish = now;
		if (Math.abs(currentBass - publishedBass) > 0.008) {
			publishedBass = currentBass;
			bassLevel.set(currentBass);
		}
		spectrum.set(currentBins.slice());
	}
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
