/** Local rain model: Open-Meteo + station trend + RainViewer nowcast samples.
 *  Not a trained net. Fusion is deterministic so the island can alert. */

import { parseIsoMs } from './atmosphere.js';

function clamp01(n) {
	const x = Number(n);
	if (!Number.isFinite(x)) return 0;
	return Math.min(1, Math.max(0, x));
}

function hoursFrom(iso, nowMs) {
	const t = parseIsoMs(iso);
	if (!t) return Infinity;
	return (t - nowMs) / 36e5;
}

function hourlyScore(hourly, nowMs, maxHours) {
	if (!hourly?.length) return 0;
	const rows = hourly
		.map((h) => ({
			hours: hoursFrom(h.time, nowMs),
			prob: h.precipitation_probability ?? 0,
			intensity: h.precipitation ?? h.rain ?? 0
		}))
		.filter((p) => p.hours >= -0.05 && p.hours <= maxHours);
	if (!rows.length) return 0;
	const maxProb = Math.max(...rows.map((p) => p.prob));
	const avgInt = rows.reduce((s, p) => s + p.intensity, 0) / rows.length;
	return clamp01((maxProb / 100) * 0.7 + Math.min(avgInt * 2, 0.3));
}

function minutelyScore(minutely, nowMs, maxHours) {
	if (!minutely?.length) return 0;
	const rows = minutely.filter((m) => {
		const hours = hoursFrom(m.time, nowMs);
		return hours >= -0.05 && hours <= maxHours;
	});
	if (!rows.length) return 0;
	const maxPrecip = Math.max(...rows.map((m) => Number(m.precipitation || m.rain || 0)));
	const anyWet = rows.some((m) => Number(m.precipitation || m.rain || 0) > 0.01);
	const wetCode = rows.some((m) => {
		const c = Number(m.weather_code);
		return Number.isFinite(c) && c >= 51 && c <= 99;
	});
	return clamp01(Math.min(maxPrecip * 3.2, 0.85) + (anyWet || wetCode ? 0.15 : 0));
}

function stationTrend(history, nowMs = Date.now()) {
	const recent = (history || []).filter((h) => nowMs - (h.ts || 0) <= 30 * 60 * 1000);
	const rainingNow = recent.some((h) => (h.rainin || 0) > 0.001);
	return {
		rainingNow,
		samples: recent.length,
		wet: rainingNow ? 0.55 : 0,
		dry: !rainingNow && recent.length > 2 ? 0.08 : 0
	};
}

function radarScore(samples, nowMs, maxMin) {
	if (!samples?.length) return 0;
	const hi = maxMin;
	const lo = -2;
	const rows = samples.filter((s) => {
		const min = (s.ts - nowMs) / 60000;
		return min >= lo && min <= hi;
	});
	if (!rows.length) return 0;
	return clamp01(Math.max(...rows.map((s) => Number(s.intensity) || 0)));
}

function etaMinutes(minutely, radarSamples, nowMs) {
	const candidates = [];
	for (const m of minutely || []) {
		const t = parseIsoMs(m.time);
		if (!t || t < nowMs - 60_000) continue;
		if (Number(m.precipitation || m.rain || 0) > 0.02) {
			candidates.push(Math.max(0, Math.round((t - nowMs) / 60000)));
		}
	}
	for (const s of radarSamples || []) {
		if ((s.intensity || 0) < 0.12) continue;
		if (s.ts < nowMs - 60_000) continue;
		candidates.push(Math.max(0, Math.round((s.ts - nowMs) / 60000)));
	}
	if (!candidates.length) return null;
	return Math.min(...candidates);
}

/**
 * Fuse forecast, backyard station, and optional radar-nowcast samples.
 * `radar.samples` is `{ ts, intensity, nowcast }[]` around home.
 */
export function fuseRainPrediction({
	hourly = [],
	minutely = [],
	stationHistory = [],
	radarSamples = [],
	nowMs = Date.now()
} = {}) {
	const h30 = hourlyScore(hourly, nowMs, 0.5);
	const h60 = hourlyScore(hourly, nowMs, 1);
	const h120 = hourlyScore(hourly, nowMs, 2);
	const m30 = minutelyScore(minutely, nowMs, 0.5);
	const m60 = minutelyScore(minutely, nowMs, 1);
	const m120 = minutelyScore(minutely, nowMs, 2);
	const st = stationTrend(stationHistory, nowMs);
	const r30 = radarScore(radarSamples, nowMs, 30);
	const r60 = radarScore(radarSamples, nowMs, 60);
	const r120 = radarScore(radarSamples, nowMs, 120);

	const mix = (h, m, r) =>
		clamp01(h * 0.34 + m * 0.36 + r * 0.3 + (st.wet ? 0.12 : 0) - st.dry);

	const rain30min = Number(mix(h30, m30, r30).toFixed(2));
	const rain60min = Number(Math.max(mix(h60, m60, r60), rain30min).toFixed(2));
	const rain120min = Number(Math.max(mix(h120, m120, r120), rain60min).toFixed(2));
	const etaMin = etaMinutes(minutely, radarSamples, nowMs);
	const pastRadar = (radarSamples || []).filter((s) => !s.nowcast);
	const pastWet = pastRadar.some((s) => (s.intensity || 0) >= 0.12);
	const futureWet = (radarSamples || []).some((s) => s.nowcast && (s.intensity || 0) >= 0.12);
	const approaching = Boolean(
		(futureWet && !pastWet) ||
			(etaMin != null && etaMin <= 60 && (rain60min >= 0.2 || futureWet))
	);

	let source = 'forecast';
	if (radarSamples?.length && (r30 > 0.02 || r60 > 0.02)) source = 'nowcast+forecast';
	else if (st.samples) source = 'station+forecast';
	else if (minutely?.length) source = 'minutely+forecast';

	return {
		rain30min,
		rain60min,
		rain120min,
		source,
		etaMin,
		approaching
	};
}

/** Merge a server forecast with later radar samples without dropping hourly skill. */
export function mergeRadarPrediction(serverPred, radarSamples, nowMs = Date.now()) {
	const fused = fuseRainPrediction({
		hourly: [],
		radarSamples,
		nowMs
	});
	const a = serverPred || { rain30min: 0, rain60min: 0, rain120min: 0, source: 'forecast' };
	if (!radarSamples?.length) {
		return {
			...a,
			etaMin: a.etaMin ?? null,
			approaching: Boolean(a.approaching)
		};
	}
	const rain30min = Number(Math.max(a.rain30min || 0, fused.rain30min).toFixed(2));
	const rain60min = Number(Math.max(a.rain60min || 0, fused.rain60min, rain30min).toFixed(2));
	const rain120min = Number(Math.max(a.rain120min || 0, fused.rain120min, rain60min).toFixed(2));
	const etaMin =
		a.etaMin != null && fused.etaMin != null
			? Math.min(a.etaMin, fused.etaMin)
			: (fused.etaMin ?? a.etaMin ?? null);
	return {
		rain30min,
		rain60min,
		rain120min,
		source: fused.source === 'nowcast+forecast' ? 'nowcast+forecast' : a.source || fused.source,
		etaMin,
		approaching: Boolean(a.approaching || fused.approaching)
	};
}

export function rainIntensityFromRgba(r, g, b, a) {
	if (a < 8) return 0;
	const maxc = Math.max(r, g, b);
	return (maxc / 255) * (a / 255);
}

/** Average rain intensity over a packed RGBA buffer (small patch, not a full frame). */
export function samplePatchIntensity(data, width, height) {
	if (!data?.length || !width || !height) return 0;
	let sum = 0;
	let n = 0;
	for (let i = 0; i < data.length; i += 4) {
		sum += rainIntensityFromRgba(data[i], data[i + 1], data[i + 2], data[i + 3]);
		n += 1;
	}
	return n ? clamp01(sum / n) : 0;
}

export function alertKeyForPrediction(pred, now = new Date()) {
	const eta = pred?.etaMin;
	const bucket = eta == null ? 'none' : eta <= 15 ? '0-15' : eta <= 30 ? '15-30' : eta <= 60 ? '30-60' : '60+';
	const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
	return `${day}:${bucket}:${pred?.approaching ? 'a' : 'n'}`;
}
