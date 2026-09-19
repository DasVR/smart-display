import { writable, derived } from 'svelte/store';
import { DISPLAY_QUALITY, evaluateDisplayLoad, normalizeQuality } from '../displayLoad.js';
import { installProgress } from '../stores.js';

export const gpuLowPowerMode = writable(false);
export const displayQuality = writable(DISPLAY_QUALITY.FULL);
export const ollamaModels = writable([]);
export const ollamaStatus = writable('idle');

let manualOverride = null;
let currentQuality = DISPLAY_QUALITY.FULL;
let lastSample = { cpu: 0, ramPct: 0, inferring: false, installing: false };

if (typeof window !== 'undefined') {
	const params = new URLSearchParams(window.location.search);
	if (params.get('lowpower') === '1' || params.get('yield') === '1') {
		gpuLowPowerMode.set(true);
		displayQuality.set(DISPLAY_QUALITY.FROZEN);
		currentQuality = DISPLAY_QUALITY.FROZEN;
		ollamaStatus.set('inferring');
	}
	if (params.get('eco') === '1') {
		displayQuality.set(DISPLAY_QUALITY.ECO);
		currentQuality = DISPLAY_QUALITY.ECO;
	}
}

const POLL_MS = 2500;
const LOAD_URL = '/api/load';

export const isInferring = derived(ollamaStatus, ($status) => $status === 'inferring');

function readForcedLowPower() {
	if (typeof window === 'undefined') return false;
	const params = new URLSearchParams(window.location.search);
	return params.get('lowpower') === '1' || params.get('yield') === '1';
}

function readForcedEco() {
	if (typeof window === 'undefined') return false;
	return new URLSearchParams(window.location.search).get('eco') === '1';
}

function commitQuality(quality, status) {
	currentQuality = quality;
	displayQuality.set(quality);
	gpuLowPowerMode.set(quality === DISPLAY_QUALITY.FROZEN);
	if (status) ollamaStatus.set(status);
}

export function applyLoadSample(sample = {}) {
	lastSample = { ...lastSample, ...sample };
	if (readForcedLowPower() || manualOverride === true) {
		commitQuality(DISPLAY_QUALITY.FROZEN, 'inferring');
		return currentQuality;
	}
	if (manualOverride === false) {
		commitQuality(readForcedEco() ? DISPLAY_QUALITY.ECO : DISPLAY_QUALITY.FULL, 'idle');
		return currentQuality;
	}
	if (readForcedEco()) {
		const next = evaluateDisplayLoad(lastSample, currentQuality);
		const quality = next.quality === DISPLAY_QUALITY.FROZEN ? DISPLAY_QUALITY.FROZEN : DISPLAY_QUALITY.ECO;
		commitQuality(quality, lastSample.inferring ? 'inferring' : quality === DISPLAY_QUALITY.FROZEN ? 'yield' : 'idle');
		return currentQuality;
	}
	if (lastSample.inferring || lastSample.installing) {
		const next = evaluateDisplayLoad(lastSample, currentQuality);
		const status = lastSample.inferring ? 'inferring' : 'yield';
		commitQuality(next.quality, status);
		return currentQuality;
	}
	if (sample.quality) {
		const quality = normalizeQuality(sample.quality);
		const status = lastSample.inferring
			? 'inferring'
			: quality === DISPLAY_QUALITY.FROZEN
				? 'yield'
				: 'idle';
		commitQuality(quality, status);
		return currentQuality;
	}
	const next = evaluateDisplayLoad(lastSample, currentQuality);
	const status = lastSample.inferring
		? 'inferring'
		: next.quality === DISPLAY_QUALITY.FROZEN
			? 'yield'
			: 'idle';
	commitQuality(next.quality, status);
	return next.quality;
}

export function toggleGpuLowPower() {
	gpuLowPowerMode.update((v) => {
		const next = !v;
		manualOverride = next;
		commitQuality(next ? DISPLAY_QUALITY.FROZEN : DISPLAY_QUALITY.FULL, next ? 'inferring' : 'idle');
		return next;
	});
}

async function fetchLoad() {
	try {
		const r = await fetch(LOAD_URL, { signal: AbortSignal.timeout(800) });
		if (!r.ok) return null;
		return await r.json();
	} catch {
		return null;
	}
}

async function fetchPs() {
	try {
		const r = await fetch('/api/ollama/ps', { signal: AbortSignal.timeout(800) });
		if (!r.ok) return null;
		return await r.json();
	} catch {
		return null;
	}
}

/**
 * Watch host CPU/RAM plus Ollama `/api/ps`. High load or a local model
 * occupying the GPU freezes or downshifts the liquid-metal shader.
 */
export function startOllamaArbiter() {
	if (typeof window === 'undefined') return () => {};

	let timer = null;
	let stopped = false;

	const onPowerEvent = (e) => {
		const state = e?.detail;
		if (state === 'LOW_POWER') {
			applyLoadSample({ inferring: true, quality: DISPLAY_QUALITY.FROZEN });
		}
		if (state === 'HIGH_PERFORMANCE' && !readForcedLowPower()) {
			applyLoadSample({ inferring: false });
		}
	};

	const onLoadEvent = (e) => {
		applyLoadSample(e?.detail || {});
	};

	window.addEventListener('power-state', onPowerEvent);
	window.addEventListener('display-load', onLoadEvent);
	const unsubInstall = installProgress.subscribe((progress) => {
		applyLoadSample({ installing: Boolean(progress?.active) });
	});

	async function poll() {
		if (stopped) return;
		const [load, ps] = await Promise.all([fetchLoad(), fetchPs()]);
		if (ps && Array.isArray(ps.models)) ollamaModels.set(ps.models);
		applyLoadSample({
			...(load || {}),
			inferring: Boolean(ps?.models?.length),
			installing: Boolean(lastSample.installing)
		});
	}

	poll();
	timer = setInterval(poll, POLL_MS);

	return () => {
		stopped = true;
		if (timer) clearInterval(timer);
		window.removeEventListener('power-state', onPowerEvent);
		window.removeEventListener('display-load', onLoadEvent);
		unsubInstall?.();
	};
}

export const startDisplayGovernor = startOllamaArbiter;
