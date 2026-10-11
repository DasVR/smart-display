/**
 * National Weather Service alerts (api.weather.gov), sorted by what they ask
 * of you, using the alert's own CAP fields rather than guessing from words:
 *
 *   warning   act now: a tornado, severe thunderstorm or flash flood
 *             warning, a hurricane or storm surge warning, an evacuation…
 *             Rings the wall until answered (src/lib/attention.js), wakes
 *             the panel, and runs the ticker.
 *   watch     be ready: watches, the slower warnings (flood, high wind,
 *             heat), Special Weather Statements. A ping on the island.
 *   advisory  worth knowing: advisories and statements (rip currents, heat
 *             advisory, beach hazards). Only on the Weather view.
 *
 * Test, exercise and cancelled messages are dropped, and so is any alert a
 * newer one updates. normalizeNws() and the server's watcher
 * (src/lib/server/nwsWatch.js) use this; so do the views.
 */

/** Warnings that mean danger now: get to safety. */
const ACT_NOW = new Set([
	'tornado warning',
	'severe thunderstorm warning',
	'flash flood warning',
	'extreme wind warning',
	'hurricane warning',
	'typhoon warning',
	'storm surge warning',
	'tropical storm warning',
	'tsunami warning',
	'snow squall warning',
	'dust storm warning',
	'blizzard warning',
	'ice storm warning',
	'earthquake warning',
	'volcano warning',
	'avalanche warning',
	'fire warning',
	'evacuation immediate',
	'shelter in place warning',
	'civil danger warning',
	'civil emergency message',
	'hazardous materials warning',
	'nuclear power plant warning',
	'radiological hazard warning',
	'law enforcement warning',
	'child abduction emergency',
	'local area emergency'
]);

/** Statements that are really "a strong storm is near you". */
const HEADS_UP = new Set(['special weather statement', 'severe weather statement', 'flash flood statement', 'hurricane local statement', 'tropical cyclone statement']);

const TIER_RANK = { warning: 0, watch: 1, advisory: 2 };

/** 'warning' | 'watch' | 'advisory' (see above). */
export function alertTier(alert = {}) {
	const event = String(alert.event || '').trim().toLowerCase();
	const severity = String(alert.severity || '').toLowerCase();
	const urgency = String(alert.urgency || '').toLowerCase();
	const certainty = String(alert.certainty || '').toLowerCase();
	if (ACT_NOW.has(event)) return 'warning';
	if (/emergency\b/.test(event) && severity !== 'minor') return 'warning'; // flash flood / tornado emergencies
	if (severity === 'extreme' && (urgency === 'immediate' || urgency === 'expected')) return 'warning';
	if (severity === 'severe' && urgency === 'immediate' && (certainty === 'observed' || certainty === 'likely')) return 'warning';
	if (/\bwatch$/.test(event) || /\bwarning$/.test(event) || HEADS_UP.has(event)) return 'watch';
	if (severity === 'extreme' || severity === 'severe') return 'watch';
	return 'advisory';
}

/** Kept as the name the views use: the act-now tier. */
export function isExtremeAlert(alert) {
	if (!alert) return false;
	return (alert.tier || alertTier(alert)) === 'warning';
}

function idOf(ref) {
	// references are full URLs or bare urn:oid ids; compare on the id
	return String(ref || '').split('/').pop();
}

/** One GeoJSON feature from /alerts/active, flattened to what the wall uses. */
export function normalizeFeature(feature = {}) {
	const p = feature.properties || {};
	const alert = {
		id: idOf(p.id || feature.id),
		event: p.event || 'Alert',
		severity: p.severity || 'Unknown',
		urgency: p.urgency || 'Unknown',
		certainty: p.certainty || 'Unknown',
		status: p.status || 'Actual',
		messageType: p.messageType || 'Alert',
		headline: p.headline || p.parameters?.NWSheadline?.[0] || '',
		description: p.description || '',
		instruction: p.instruction || '',
		areaDesc: p.areaDesc || '',
		sender: p.senderName || '',
		sent: p.sent || null,
		onset: p.onset || p.effective || null,
		expires: p.expires || null,
		ends: p.ends || null,
		// a storm-based warning has its own polygon; zone alerts cover the county
		polygon: Boolean(feature.geometry),
		references: (p.references || []).map((r) => idOf(r.identifier || r['@id'] || r))
	};
	alert.tier = alertTier(alert);
	return alert;
}

/**
 * The alerts that matter right now, most urgent first: real (not test or
 * exercise), not cancelled, not over, and not replaced by a newer update.
 */
export function normalizeNws(geojson, now = Date.now()) {
	const all = (geojson?.features || []).map(normalizeFeature);
	const superseded = new Set(all.flatMap((a) => a.references));
	return all
		.filter((a) => String(a.status).toLowerCase() === 'actual')
		.filter((a) => String(a.messageType).toLowerCase() !== 'cancel')
		.filter((a) => !superseded.has(a.id))
		.filter((a) => {
			const end = Date.parse(a.ends || a.expires || '');
			return !Number.isFinite(end) || end > now;
		})
		.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || (Date.parse(b.sent || '') || 0) - (Date.parse(a.sent || '') || 0));
}

/** extreme: act now (ticker, attention). island: be ready (one ping). Advisories stay on the Weather view. */
export function splitNwsAlerts(alerts = []) {
	const extreme = [];
	const island = [];
	for (const a of alerts || []) {
		const tier = a.tier || alertTier(a);
		if (tier === 'warning') extreme.push(a);
		else if (tier === 'watch') island.push(a);
	}
	return { extreme, island };
}

export function tickerText(alerts = []) {
	const parts = (alerts || [])
		.map((a) => {
			const event = String(a.event || 'Alert').trim();
			const head = String(a.headline || '').replace(/\s+/g, ' ').trim();
			if (head && !head.toLowerCase().startsWith(event.toLowerCase())) {
				return `${event}: ${head}`;
			}
			return head || event;
		})
		.filter(Boolean);
	return parts.join('   ·   ');
}

export const RAIN_ISLAND_SCORE = 0.55;
export const RAIN_ISLAND_SCORE_2H = 0.7;

function rainTitle(p = {}) {
	if (p.etaMin != null && p.etaMin <= 120 && (p.approaching || p.rain60min >= 0.2)) {
		if (p.etaMin <= 5) return 'Rain arriving';
		return `Rain in ${p.etaMin} min`;
	}
	if (p.rain30min >= RAIN_ISLAND_SCORE) return 'Rain in 30 min';
	if (p.rain60min >= RAIN_ISLAND_SCORE) return 'Rain in an hour';
	if (p.rain120min >= RAIN_ISLAND_SCORE_2H) return 'Rain in 2 hours';
	if (p.approaching) return 'Rain approaching';
	return 'Clear skies';
}

function rainSub(p = {}) {
	if (p.etaMin != null && p.etaMin <= 5) return 'Nowcast sees rain near home';
	if (p.etaMin != null && p.etaMin <= 120) return `About ${p.etaMin} min out`;
	if (p.source === 'nowcast+forecast') return 'Radar nowcast over Largo';
	if (p.source) return `From ${p.source}`;
	return '';
}

function windExtra(current = {}) {
	const spd = Number(current.windSpeed);
	if (!Number.isFinite(spd)) return '';
	return `${Math.round(spd)} mph wind`;
}

/** Copy for the island weather slip. Extreme NWS stays off this surface. */
export function islandWeatherSlip(weatherData) {
	const { island } = splitNwsAlerts(weatherData?.alerts);
	const p = weatherData?.prediction || {};
	const current = weatherData?.current || {};
	const extra = windExtra(current);

	if (island.length) {
		const top = island[0];
		return {
			active: true,
			severity: 'warn',
			kicker: 'Weather',
			title: top.event || 'Weather alert',
			sub: String(top.headline || '').replace(/\s+/g, ' ').trim(),
			extra,
			chimeKey: `nws:${top.id || top.event}`
		};
	}

	const approaching = Boolean(p.approaching) || (p.etaMin != null && p.etaMin <= 60 && p.rain60min >= 0.2);
	const likely =
		(p.rain30min ?? 0) >= RAIN_ISLAND_SCORE ||
		(p.rain60min ?? 0) >= RAIN_ISLAND_SCORE ||
		(p.rain120min ?? 0) >= RAIN_ISLAND_SCORE_2H;
	if (!approaching && !likely) {
		return { active: false, severity: 'info', kicker: '', title: '', sub: '', extra: '', chimeKey: '' };
	}

	return {
		active: true,
		severity: 'warn',
		kicker: 'Radar',
		title: rainTitle(p),
		sub: rainSub(p),
		extra,
		chimeKey: `rain:${p.approaching ? 'a' : 'n'}:${p.etaMin == null ? 'none' : p.etaMin <= 15 ? '0-15' : p.etaMin <= 30 ? '15-30' : p.etaMin <= 60 ? '30-60' : '60+'}`
	};
}
