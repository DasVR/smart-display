/** Display-local solar and wind helpers. Times are America/New_York. */

export const DISPLAY_TZ = 'America/New_York';
export const TWILIGHT_MS = 45 * 60 * 1000;

const COMPASS = [
	'N',
	'NNE',
	'NE',
	'ENE',
	'E',
	'ESE',
	'SE',
	'SSE',
	'S',
	'SSW',
	'SW',
	'WSW',
	'W',
	'WNW',
	'NW',
	'NNW'
];

export function clamp01(n) {
	const x = Number(n);
	if (!Number.isFinite(x)) return 0;
	return Math.min(1, Math.max(0, x));
}

export function parseIsoMs(iso, timeZone = DISPLAY_TZ) {
	if (!iso) return null;
	if (/[zZ]|[+-]\d{2}:\d{2}$/.test(String(iso))) {
		const t = Date.parse(iso);
		return Number.isFinite(t) ? t : null;
	}
	const t = parseWallTime(iso, timeZone);
	return Number.isFinite(t) ? t : null;
}

/** Parse an Open-Meteo wall clock (`2026-09-12T15:00`) in `timeZone`. */
export function parseWallTime(iso, timeZone = DISPLAY_TZ) {
	if (!iso) return NaN;
	const naive = String(iso).length === 16 ? `${iso}:00` : String(iso);
	const [datePart, timePart] = naive.split('T');
	if (!datePart || !timePart) return Date.parse(iso);
	const [y, mo, d] = datePart.split('-').map(Number);
	const [h, mi, s] = timePart.split(':').map(Number);
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	});
	function parts(ms) {
		const bag = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
		return {
			y: +bag.year,
			mo: +bag.month,
			d: +bag.day,
			h: +bag.hour,
			mi: +bag.minute,
			s: +bag.second
		};
	}
	const wantedUtc = Date.UTC(y, mo - 1, d, h, mi || 0, s || 0);
	let t = wantedUtc;
	for (let i = 0; i < 3; i++) {
		const wall = parts(t);
		const gotUtc = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
		t += wantedUtc - gotUtc;
	}
	return t;
}

function hourInTz(nowMs, timeZone = DISPLAY_TZ) {
	const hour = Number(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			hour: 'numeric',
			hour12: false
		}).format(new Date(nowMs))
	);
	return Number.isFinite(hour) ? hour % 24 : 0;
}

export function fallbackPhase(nowMs, timeZone = DISPLAY_TZ) {
	const hour = hourInTz(nowMs, timeZone);
	if (hour < 6 || hour >= 21) return 'night';
	if (hour < 7) return 'dawn';
	if (hour >= 19) return 'dusk';
	return 'day';
}

/**
 * @returns {'night' | 'dawn' | 'day' | 'dusk'}
 */
export function sunPhase(nowMs, sunriseMs, sunsetMs, twilightMs = TWILIGHT_MS) {
	if (!sunriseMs || !sunsetMs) return fallbackPhase(nowMs);
	const n = nowMs;
	if (n < sunriseMs - twilightMs) return 'night';
	if (n < sunriseMs) return 'dawn';
	if (n < sunsetMs) return 'day';
	if (n < sunsetMs + twilightMs) return 'dusk';
	return 'night';
}

/** 0 = night metal, 1 = the kiosk's existing daytime metal. */
export function sunAmount(nowMs, sunriseMs, sunsetMs, twilightMs = TWILIGHT_MS) {
	if (!sunriseMs || !sunsetMs) {
		const phase = fallbackPhase(nowMs);
		if (phase === 'night') return 0.16;
		if (phase === 'dawn' || phase === 'dusk') return 0.42;
		return 1;
	}
	const n = nowMs;
	if (n <= sunriseMs - twilightMs || n >= sunsetMs + twilightMs) return 0.12;
	if (n < sunriseMs) {
		return 0.12 + 0.38 * clamp01((n - (sunriseMs - twilightMs)) / twilightMs);
	}
	if (n > sunsetMs) {
		return 0.12 + 0.38 * (1 - clamp01((n - sunsetMs) / twilightMs));
	}
	const noon = (sunriseMs + sunsetMs) / 2;
	const half = Math.max(1, (sunsetMs - sunriseMs) / 2);
	const peak = 1 - Math.abs(n - noon) / half;
	return 0.55 + 0.45 * clamp01(peak);
}

/** 0 at night/noon, 1 at the sunrise or sunset instant. */
export function twilightAmount(nowMs, sunriseMs, sunsetMs, twilightMs = TWILIGHT_MS) {
	if (!sunriseMs || !sunsetMs) {
		const phase = fallbackPhase(nowMs);
		return phase === 'dawn' || phase === 'dusk' ? 0.7 : 0;
	}
	const dawn = 1 - Math.abs(nowMs - sunriseMs) / twilightMs;
	const dusk = 1 - Math.abs(nowMs - sunsetMs) / twilightMs;
	return clamp01(Math.max(dawn, dusk));
}

export function phaseKicker(phase, weekday = '') {
	switch (phase) {
		case 'night':
			return weekday ? `After dark · ${weekday}` : 'After dark';
		case 'dawn':
			return weekday ? `Dawn · ${weekday}` : 'Dawn';
		case 'dusk':
			return weekday ? `Dusk · ${weekday}` : 'Dusk';
		default:
			return weekday || 'Today';
	}
}

export function compassFromDeg(deg) {
	if (!Number.isFinite(Number(deg))) return '--';
	const wrapped = ((Number(deg) % 360) + 360) % 360;
	const i = Math.round(wrapped / 22.5) % 16;
	return COMPASS[i];
}

/** Meteorological `from` degrees → direction the wind travels (screen arrow). */
export function windTowardDeg(fromDeg) {
	return (((Number(fromDeg) + 180) % 360) + 360) % 360;
}

export function fmtSunTime(iso, timeZone = DISPLAY_TZ) {
	const t = parseIsoMs(iso, timeZone);
	if (!t) return '--';
	return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
}

export function atmosphereFromWeather(nowMs, weather) {
	const cur = weather?.current || {};
	const sun = weather?.sun || {};
	const pred = weather?.prediction || {};
	const sunrise = parseIsoMs(sun.sunrise);
	const sunset = parseIsoMs(sun.sunset);
	const phase = sunPhase(nowMs, sunrise, sunset);
	const raining = Number(cur.rain || cur.precipitation || 0) > 0.01
		|| cur.desc === 'Rain'
		|| cur.desc === 'Showers'
		|| cur.desc === 'Storm';
	const rain = clamp01(
		Math.max(
			Number(pred.rain60min) || 0,
			raining ? 0.72 : 0,
			Math.min((Number(cur.rain || cur.precipitation) || 0) * 4, 1)
		)
	);
	const windSpeed = Number(cur.windSpeed) || 0;
	const windFrom = Number(cur.windDirection);
	return {
		phase,
		sun: sunAmount(nowMs, sunrise, sunset),
		twilight: twilightAmount(nowMs, sunrise, sunset),
		rain,
		wind: clamp01(windSpeed / 28),
		cloud: clamp01((Number(cur.cloudCover) || 0) / 100),
		windFrom: Number.isFinite(windFrom) ? windFrom : null,
		windToward: Number.isFinite(windFrom) ? windTowardDeg(windFrom) : 0,
		windRad: Number.isFinite(windFrom) ? (windTowardDeg(windFrom) * Math.PI) / 180 : 0,
		windSpeed,
		compass: compassFromDeg(windFrom),
		kicker: phaseKicker(phase),
		sunrise: sun.sunrise || null,
		sunset: sun.sunset || null
	};
}
