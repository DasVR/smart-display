import { writable, derived } from 'svelte/store';

export const gpuLowPowerMode = writable(false);
export const ollamaModels = writable([]);
export const ollamaStatus = writable('idle');

let manualOverride = null;

const POLL_MS = 500;
const OLLAMA_URLS = ['http://127.0.0.1:11434/api/ps', '/api/ollama/ps'];

export const isInferring = derived(
	ollamaStatus,
	($status) => $status === 'inferring'
);

function readForcedLowPower() {
	if (typeof window === 'undefined') return false;
	const params = new URLSearchParams(window.location.search);
	return params.get('lowpower') === '1' || params.get('yield') === '1';
}

function applyLowPower(next, status) {
	gpuLowPowerMode.set(next);
	ollamaStatus.set(status);
}

export function toggleGpuLowPower() {
	gpuLowPowerMode.update((v) => {
		const next = !v;
		manualOverride = next;
		ollamaStatus.set(next ? 'inferring' : 'idle');
		return next;
	});
}

async function fetchPs() {
	for (const url of OLLAMA_URLS) {
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(800) });
			if (!r.ok) continue;
			const data = await r.json();
			return data;
		} catch {
			continue;
		}
	}
	return null;
}

/**
 * Poll Ollama `/api/ps`. Non-empty `models` means local inference is occupying
 * the GPU — freeze the liquid-metal shader so the LLM gets the iGPU.
 */
export function startOllamaArbiter() {
	if (typeof window === 'undefined') return () => {};

	let timer = null;
	let stopped = false;

	const onPowerEvent = (e) => {
		const state = e?.detail;
		if (state === 'LOW_POWER') applyLowPower(true, 'inferring');
		if (state === 'HIGH_PERFORMANCE' && !readForcedLowPower()) {
			applyLowPower(false, 'idle');
		}
	};

	window.addEventListener('power-state', onPowerEvent);

	async function poll() {
		if (stopped) return;
		if (readForcedLowPower()) {
			applyLowPower(true, 'inferring');
			return;
		}
		if (manualOverride !== null) {
			applyLowPower(manualOverride, manualOverride ? 'inferring' : 'idle');
			return;
		}
		const data = await fetchPs();
		if (data == null) {
			ollamaModels.set([]);
			if (!readForcedLowPower()) applyLowPower(false, 'unreachable');
			return;
		}
		const models = Array.isArray(data.models) ? data.models : [];
		ollamaModels.set(models);
		if (models.length > 0) {
			applyLowPower(true, 'inferring');
		} else {
			applyLowPower(false, 'idle');
		}
	}

	poll();
	timer = setInterval(poll, POLL_MS);

	return () => {
		stopped = true;
		if (timer) clearInterval(timer);
		window.removeEventListener('power-state', onPowerEvent);
	};
}
