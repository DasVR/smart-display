/** Neighborhood Ambient Weather mesh around a home point.
 *  Public map devices plus an optional backyard station are interpolated
 *  at the parcel: a containing triangle when one exists, otherwise IDW. */

export const INHG_TO_HPA = 33.86389;
export const EARTH_RADIUS_MI = 3958.761;
export const LOCAL_RADIUS_MI = 3.5;
export const NEIGHBORHOOD_RADIUS_MI = 8;
export const MAX_STATION_AGE_MS = 20 * 60 * 1000;
export const TEMP_OUTLIER_F = 12;
export const IDW_POWER = 2;
export const MIN_IDW_DIST_MI = 0.05;
export const AMBIENT_DEVICES_HOST = 'https://lightning.ambientweather.net';

function num(v) {
	if (v === undefined || v === null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function roundTo(n, digits) {
	if (!Number.isFinite(n)) return null;
	const f = 10 ** digits;
	return Math.round(n * f) / f;
}

/** Ambient `dateutc` is usually ms; older feeds send seconds. */
export function normalizeUtc(dateutc) {
	const n = Number(dateutc);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return n < 1e12 ? n * 1000 : n;
}

export function inHgToHpa(value) {
	if (value === undefined || value === null || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	if (n > 50) return n;
	return n * INHG_TO_HPA;
}

export function haversineMiles(a, b) {
	const rlat1 = (a.lat * Math.PI) / 180;
	const rlat2 = (b.lat * Math.PI) / 180;
	const dlat = ((b.lat - a.lat) * Math.PI) / 180;
	const dlon = ((b.lon - a.lon) * Math.PI) / 180;
	const h =
		Math.sin(dlat / 2) ** 2 +
		Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2;
	return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function shiftBox(lat, lon, radiusMi) {
	const dlat = (radiusMi / EARTH_RADIUS_MI) * (180 / Math.PI);
	const cosLat = Math.cos((lat * Math.PI) / 180);
	const dlon = (radiusMi / (EARTH_RADIUS_MI * Math.max(0.2, cosLat))) * (180 / Math.PI);
	return {
		south: lat - dlat,
		west: lon - dlon,
		north: lat + dlat,
		east: lon + dlon
	};
}

export function publicDevicesUrl(lat, lon, radiusMi, limit = 200) {
	const b = shiftBox(lat, lon, radiusMi);
	const q = new URLSearchParams({
		'$publicBox[0][0]': String(b.west),
		'$publicBox[0][1]': String(b.south),
		'$publicBox[1][0]': String(b.east),
		'$publicBox[1][1]': String(b.north),
		$limit: String(limit)
	});
	return `${AMBIENT_DEVICES_HOST}/devices?${q}`;
}

export function parsePublicDevice(row) {
	if (!row || typeof row !== 'object') return null;
	const coords = row.info?.coords?.coords || {};
	const last = row.lastData || {};
	const lat = num(coords.lat);
	const lon = num(coords.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	const rel = num(last.baromrelin);
	const abs = num(last.baromabsin);
	return {
		mac: row.macAddress || null,
		name: row.info?.name || 'Station',
		lat,
		lon,
		ts: normalizeUtc(last.dateutc),
		tempf: num(last.tempf),
		humidity: num(last.humidity),
		windspeedmph: num(last.windspeedmph ?? last.windspdmph_avg10m),
		winddir: num(last.winddir ?? last.winddir_avg10m),
		windgustmph: num(last.windgustmph),
		baromrelin: rel,
		baromabsin: abs,
		pressureHpa: inHgToHpa(rel ?? abs),
		rainin: num(last.hourlyrainin ?? last.rainin)
	};
}

export function backyardToSample(station, home) {
	if (!station || !home) return null;
	const rel = num(station.baromrelin);
	const abs = num(station.baromabsin);
	return {
		mac: station.mac || 'backyard',
		name: 'Backyard',
		lat: home.lat,
		lon: home.lon,
		ts: Number(station.ts) || 0,
		tempf: num(station.tempf),
		humidity: num(station.humidity),
		windspeedmph: num(station.windspeedmph),
		winddir: num(station.winddir),
		windgustmph: num(station.windgustmph),
		baromrelin: rel,
		baromabsin: abs,
		pressureHpa: inHgToHpa(rel ?? abs),
		rainin: num(station.rainin)
	};
}

/** Collapse duplicate public listings that share a yard. Keep the newest. */
export function dedupeStations(stations) {
	const byKey = new Map();
	for (const s of stations || []) {
		if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
		const key = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
		const prev = byKey.get(key);
		if (!prev || (s.ts || 0) > (prev.ts || 0)) byKey.set(key, s);
	}
	return [...byKey.values()];
}

function median(values) {
	if (!values.length) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function orient(a, b, c) {
	return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
}

export function pointInTriangle(p, a, b, c) {
	const o1 = orient(a, b, p);
	const o2 = orient(b, c, p);
	const o3 = orient(c, a, p);
	const hasNeg = o1 < 0 || o2 < 0 || o3 < 0;
	const hasPos = o1 > 0 || o2 > 0 || o3 > 0;
	return !(hasNeg && hasPos);
}

export function barycentricWeights(p, a, b, c) {
	const den = orient(a, b, c);
	if (Math.abs(den) < 1e-18) return null;
	return [orient(b, c, p) / den, orient(c, a, p) / den, orient(a, b, p) / den];
}

function triangleArea(a, b, c) {
	return Math.abs(orient(a, b, c)) / 2;
}

/** Smallest-area triangle among the nearest stations that contains `home`. */
export function containingTriangle(stations, home, maxCandidates = 16) {
	const pts = [...stations]
		.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Number.isFinite(s.tempf))
		.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0))
		.slice(0, maxCandidates);
	let best = null;
	let bestArea = Infinity;
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			for (let k = j + 1; k < pts.length; k++) {
				const a = pts[i];
				const b = pts[j];
				const c = pts[k];
				if (!pointInTriangle(home, a, b, c)) continue;
				const area = triangleArea(a, b, c);
				if (area < 1e-16 || area >= bestArea) continue;
				bestArea = area;
				best = [a, b, c];
			}
		}
	}
	return best;
}

function idwWeights(stations, power = IDW_POWER) {
	const inv = stations.map((s) => 1 / Math.pow(Math.max(MIN_IDW_DIST_MI, s.dist || MIN_IDW_DIST_MI), power));
	const sum = inv.reduce((a, b) => a + b, 0);
	if (!sum) return stations.map(() => 0);
	return inv.map((w) => w / sum);
}

function weightedMean(samples, weights, key) {
	let acc = 0;
	let wsum = 0;
	for (let i = 0; i < samples.length; i++) {
		const v = samples[i]?.[key];
		const w = weights[i];
		if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
		acc += v * w;
		wsum += w;
	}
	if (!wsum) return null;
	return acc / wsum;
}

function circularMean(samples, weights, key) {
	let x = 0;
	let y = 0;
	let wsum = 0;
	for (let i = 0; i < samples.length; i++) {
		const d = samples[i]?.[key];
		const w = weights[i];
		if (!Number.isFinite(d) || !Number.isFinite(w) || w <= 0) continue;
		const r = (d * Math.PI) / 180;
		x += Math.cos(r) * w;
		y += Math.sin(r) * w;
		wsum += w;
	}
	if (!wsum) return null;
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function withDistances(stations, home) {
	return stations.map((s) => ({
		...s,
		dist: Math.max(MIN_IDW_DIST_MI, haversineMiles(home, s))
	}));
}

export function estimateAt(stations, home, now = Date.now()) {
	const empty = {
		temp: null,
		humidity: null,
		pressureHpa: null,
		windSpeed: null,
		windDirection: null,
		windGusts: null,
		rain: null,
		stationCount: 0,
		method: 'none'
	};
	if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return empty;

	const fresh = dedupeStations(stations).filter(
		(s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && now - (s.ts || 0) <= MAX_STATION_AGE_MS
	);
	const located = withDistances(fresh, home);
	const temps = located.map((s) => s.tempf).filter(Number.isFinite);
	const med = median(temps);
	const kept = located.filter(
		(s) => !Number.isFinite(s.tempf) || !Number.isFinite(med) || Math.abs(s.tempf - med) <= TEMP_OUTLIER_F
	);
	if (!kept.length) return empty;

	const tri = containingTriangle(kept, home);
	const method = tri ? 'triangle' : 'idw';
	const samples = tri || kept;
	const weights = tri ? barycentricWeights(home, tri[0], tri[1], tri[2]) : idwWeights(kept);
	if (!weights) {
		return { ...empty, stationCount: kept.length, method: 'idw' };
	}

	const field = (key, circular = false) => {
		const fn = circular ? circularMean : weightedMean;
		let v = fn(samples, weights, key);
		if (v == null && tri) v = fn(kept, idwWeights(kept), key);
		return v;
	};

	return {
		temp: roundTo(field('tempf'), 1),
		humidity: roundTo(field('humidity'), 0),
		pressureHpa: roundTo(field('pressureHpa'), 1),
		windSpeed: roundTo(field('windspeedmph'), 1),
		windDirection: roundTo(field('winddir', true), 0),
		windGusts: roundTo(field('windgustmph'), 1),
		rain: roundTo(field('rainin'), 2),
		stationCount: kept.length,
		method
	};
}

export function applyMeshToCurrent(forecast, mesh) {
	const base = { ...(forecast || {}) };
	if (!mesh || mesh.method === 'none') {
		return { ...base, mesh: mesh || { method: 'none', stationCount: 0 } };
	}
	return {
		...base,
		temp: mesh.temp ?? base.temp,
		humidity: mesh.humidity ?? base.humidity,
		pressure: mesh.pressureHpa ?? base.pressure,
		windSpeed: mesh.windSpeed ?? base.windSpeed,
		windDirection: mesh.windDirection ?? base.windDirection,
		windGusts: mesh.windGusts ?? base.windGusts,
		rain: mesh.rain ?? base.rain,
		mesh
	};
}
