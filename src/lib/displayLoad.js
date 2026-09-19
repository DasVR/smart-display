/**
 * Host-load → display quality. The kiosk shares a Ryzen iGPU with Ollama
 * and whatever else the box is doing, so the liquid-metal shader has to
 * get out of the way before the machine feels hot or laggy.
 *
 * Three tiers:
 *   full    — 1280×720 shader, glass, grain, 60fps
 *   eco     — half-res shader, no SDF glass, no grain, 30fps
 *   frozen  — last frame held, rAF stopped (Ollama / heavy CPU / RAM)
 *
 * Hysteresis is the point: a 1s CPU spike must not flicker the background.
 */

export const DISPLAY_QUALITY = {
	FULL: 'full',
	ECO: 'eco',
	FROZEN: 'frozen'
};

export const LOAD_THRESHOLDS = {
	ecoCpu: 55,
	freezeCpu: 82,
	ecoRam: 78,
	freezeRam: 90,
	recoverEcoCpu: 42,
	recoverEcoRam: 68,
	recoverFreezeCpu: 62,
	recoverFreezeRam: 80
};

const QUALITIES = new Set(Object.values(DISPLAY_QUALITY));

export function normalizeQuality(value, fallback = DISPLAY_QUALITY.FULL) {
	return QUALITIES.has(value) ? value : fallback;
}

function num(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function reasonsFor(sample, cpu, ram) {
	const reasons = [];
	if (sample.inferring) reasons.push('inferring');
	if (sample.installing) reasons.push('installing');
	if (cpu >= LOAD_THRESHOLDS.freezeCpu) reasons.push('cpu');
	else if (cpu >= LOAD_THRESHOLDS.ecoCpu) reasons.push('cpu-eco');
	if (ram >= LOAD_THRESHOLDS.freezeRam) reasons.push('ram');
	else if (ram >= LOAD_THRESHOLDS.ecoRam) reasons.push('ram-eco');
	return reasons;
}

/** Decide the next quality from a load sample and the current tier. */
export function evaluateDisplayLoad(sample = {}, prevQuality = DISPLAY_QUALITY.FULL) {
	const prev = normalizeQuality(prevQuality);
	const cpu = num(sample.cpu);
	const ram = num(sample.ramPct);
	const forced = Boolean(sample.inferring || sample.installing);
	const freezeHit = forced || cpu >= LOAD_THRESHOLDS.freezeCpu || ram >= LOAD_THRESHOLDS.freezeRam;
	const ecoHit = cpu >= LOAD_THRESHOLDS.ecoCpu || ram >= LOAD_THRESHOLDS.ecoRam;

	let quality = DISPLAY_QUALITY.FULL;
	if (freezeHit) {
		quality = DISPLAY_QUALITY.FROZEN;
	} else if (prev === DISPLAY_QUALITY.FROZEN) {
		const stillHot =
			cpu > LOAD_THRESHOLDS.recoverFreezeCpu || ram > LOAD_THRESHOLDS.recoverFreezeRam;
		quality = stillHot || ecoHit ? DISPLAY_QUALITY.ECO : DISPLAY_QUALITY.FULL;
	} else if (ecoHit) {
		quality = DISPLAY_QUALITY.ECO;
	} else if (
		prev === DISPLAY_QUALITY.ECO &&
		(cpu > LOAD_THRESHOLDS.recoverEcoCpu || ram > LOAD_THRESHOLDS.recoverEcoRam)
	) {
		quality = DISPLAY_QUALITY.ECO;
	}

	return {
		quality,
		freezeShaders: quality === DISPLAY_QUALITY.FROZEN,
		eco: quality === DISPLAY_QUALITY.ECO,
		reasons: reasonsFor(sample, cpu, ram)
	};
}
