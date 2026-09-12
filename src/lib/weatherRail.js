/** Classify a persistent, TV-style weather strip from NWS alerts + rain scores.
 *  The island stays free for transient events; this rail holds while the
 *  condition is still true. Scores are 0..1 from `predictRain()`. */

export const RAIN_RAIL_SCORE = 0.55;
export const RAIN_RAIL_SCORE_2H = 0.7;

const WARNING_SEVERITIES = new Set(['extreme', 'severe']);

function alertCopy(alert) {
	const event = String(alert?.event || 'Weather alert').trim() || 'Weather alert';
	const body = String(alert?.headline || '').trim();
	return { event, body };
}

function isWarningAlert(alert) {
	const severity = String(alert?.severity || '').toLowerCase();
	const event = String(alert?.event || '');
	// A watch/advisory keeps the quieter strip even when NWS marks it Severe.
	if (/watch|advisory/i.test(event)) return false;
	return WARNING_SEVERITIES.has(severity) || /warning/i.test(event);
}

function isWatchAlert(alert) {
	const event = String(alert?.event || '');
	const severity = String(alert?.severity || '').toLowerCase();
	return /watch|advisory/i.test(event) || severity === 'moderate';
}

/**
 * @param {{ alerts?: Array<{ event?: string, severity?: string, headline?: string }>, prediction?: { rain30min?: number, rain60min?: number, rain120min?: number } } | null | undefined} weatherData
 * @returns {{ kind: 'warning' | 'watch' | 'rain', kicker: string, title: string, body: string, severity: 'warn' | 'info' } | null}
 */
export function classifyWeatherRail(weatherData) {
	const alerts = Array.isArray(weatherData?.alerts) ? weatherData.alerts : [];
	let warning = null;
	let watch = null;

	for (const alert of alerts) {
		const { event, body } = alertCopy(alert);
		if (isWarningAlert(alert)) {
			if (!warning) {
				warning = {
					kind: 'warning',
					kicker: 'Weather warning',
					title: event,
					body,
					severity: 'warn'
				};
			}
			continue;
		}
		if (!watch) {
			const namedWatch = isWatchAlert(alert);
			watch = {
				kind: 'watch',
				kicker: namedWatch ? 'Weather watch' : 'Weather notice',
				title: event,
				body,
				severity: 'info'
			};
		}
	}

	if (warning) return warning;
	if (watch) return watch;

	const prediction = weatherData?.prediction || {};
	const rain30 = Number(prediction.rain30min) || 0;
	const rain60 = Number(prediction.rain60min) || 0;
	const rain120 = Number(prediction.rain120min) || 0;
	const eta = Number.isFinite(Number(prediction.etaMin)) ? Number(prediction.etaMin) : null;
	const approaching = Boolean(prediction.approaching);

	if (approaching || (eta != null && eta <= 60 && (rain60 >= 0.2 || rain30 >= RAIN_RAIL_SCORE))) {
		if (eta != null && eta <= 5) {
			return {
				kind: 'rain',
				kicker: 'Incoming rain',
				title: 'Rain arriving',
				body: 'A wet band is over home.',
				severity: 'info'
			};
		}
		if (eta != null && eta <= 120) {
			return {
				kind: 'rain',
				kicker: 'Incoming rain',
				title: `Rain in ${Math.round(eta)} minutes`,
				body: 'Keep an eye on the radar.',
				severity: 'info'
			};
		}
		return {
			kind: 'rain',
			kicker: 'Incoming rain',
			title: 'Rain moving in',
			body: 'Nowcast sees a wet band near home.',
			severity: 'info'
		};
	}

	if (rain30 >= RAIN_RAIL_SCORE) {
		return {
			kind: 'rain',
			kicker: 'Incoming rain',
			title: 'Rain in 30 minutes',
			body: 'A wet band is moving in.',
			severity: 'info'
		};
	}
	if (rain60 >= RAIN_RAIL_SCORE) {
		return {
			kind: 'rain',
			kicker: 'Incoming rain',
			title: 'Rain in an hour',
			body: 'Keep an eye on the radar.',
			severity: 'info'
		};
	}
	if (rain120 >= RAIN_RAIL_SCORE_2H) {
		return {
			kind: 'rain',
			kicker: 'Incoming rain',
			title: 'Rain in 2 hours',
			body: 'A wet band is on the way.',
			severity: 'info'
		};
	}

	return null;
}
