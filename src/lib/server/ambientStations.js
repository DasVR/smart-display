import {
	LOCAL_RADIUS_MI,
	NEIGHBORHOOD_RADIUS_MI,
	dedupeStations,
	parsePublicDevice,
	publicDevicesUrl
} from '../ambientMesh.js';

const CACHE_TTL_MS = 180_000;
const FETCH_TIMEOUT_MS = 8000;

let cache = { ts: 0, lat: null, lon: null, stations: [] };

const AMBIENT_HEADERS = {
	Accept: 'application/json',
	Origin: 'https://ambientweather.net',
	Referer: 'https://ambientweather.net/',
	'User-Agent': 'smart-display-kiosk'
};

async function fetchBox(url, fetchImpl) {
	try {
		const r = await fetchImpl(url, {
			headers: AMBIENT_HEADERS,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!r.ok) return [];
		const d = await r.json();
		return Array.isArray(d?.data) ? d.data : [];
	} catch (e) {
		console.error('ambient stations error:', e.message);
		return [];
	}
}

/** Public Ambient map devices near a point. Local box + wider box, merged.
 *  The wide query truncates and can drop the nearest yards, so the tight
 *  box is what actually keeps Largo-side stations in the mix. */
export async function fetchAmbientStations(lat, lon, { now = Date.now(), fetchImpl = fetch } = {}) {
	if (
		cache.stations.length &&
		cache.lat === lat &&
		cache.lon === lon &&
		now - cache.ts < CACHE_TTL_MS
	) {
		return cache.stations;
	}

	const urls = [
		publicDevicesUrl(lat, lon, LOCAL_RADIUS_MI, 200),
		publicDevicesUrl(lat, lon, NEIGHBORHOOD_RADIUS_MI, 200)
	];
	const bodies = await Promise.all(urls.map((url) => fetchBox(url, fetchImpl)));
	const stations = dedupeStations(bodies.flat().map(parsePublicDevice).filter(Boolean));
	if (stations.length) {
		cache = { ts: now, lat, lon, stations };
	}
	return stations;
}

export function resetAmbientStationCache() {
	cache = { ts: 0, lat: null, lon: null, stations: [] };
}
