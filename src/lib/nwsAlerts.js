/** Route NWS products: ordinary watches stay on the island; tornado,
 *  hurricane, and Extreme-severity products take the rolling ticker. */

const EXTREME_RE =
	/\b(tornado|hurricane|typhoon|tsunami|storm surge|tropical storm|tropical depression|tropical cyclone|extreme wind|particularly dangerous|flash flood emergency)\b/i;

export function isExtremeAlert(alert) {
	if (!alert) return false;
	if (String(alert.severity || '').toLowerCase() === 'extreme') return true;
	const hay = [alert.event, alert.headline, alert.description].filter(Boolean).join(' ');
	return EXTREME_RE.test(hay);
}

export function splitNwsAlerts(alerts = []) {
	const extreme = [];
	const island = [];
	for (const a of alerts || []) {
		if (isExtremeAlert(a)) extreme.push(a);
		else island.push(a);
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
			chimeKey: `nws:${top.event}`
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
