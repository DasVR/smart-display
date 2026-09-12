/**
 * Persistent status chips for the bottom trough: downed services, brief
 * recoveries, and similar ongoing health. These used to live on the
 * Dynamic Island, where they covered the date and view tabs.
 */

export function serviceActivityId(name) {
	const n = String(name || '').trim() || 'unknown';
	return `svc:${n}`;
}

export function serviceActivity(name) {
	return {
		id: serviceActivityId(name),
		kind: 'service',
		title: name,
		body: 'Down',
		severity: 'error'
	};
}

export function recoveredActivity(name) {
	return {
		id: `${serviceActivityId(name)}:ok`,
		kind: 'recovered',
		title: name,
		body: 'Recovered',
		severity: 'ok',
		ttl: 5000
	};
}

function severityRank(severity) {
	switch (severity) {
		case 'error':
			return 0;
		case 'warn':
			return 1;
		case 'ok':
			return 2;
		default:
			return 3;
	}
}

/**
 * Diff a telemetry service list into dock chips + chime events.
 * The first snapshot (`prev === null`) seeds down services silently so boot
 * does not chime for things that were already down.
 */
export function applyServiceSnapshot(prev, next) {
	const curr = Array.isArray(next) ? next : [];
	const seed = prev === null;
	const events = [];
	const set = [];
	const clear = [];
	const prevByName = new Map((prev || []).map((s) => [s.name, s.status]));

	for (const svc of curr) {
		if (!svc || typeof svc.name !== 'string') continue;
		const up = svc.status === true;
		const known = prevByName.has(svc.name);
		const was = known ? prevByName.get(svc.name) : undefined;
		const downId = serviceActivityId(svc.name);
		const okId = recoveredActivity(svc.name).id;

		if (seed) {
			if (!up) set.push(serviceActivity(svc.name));
			continue;
		}

		if (was === true && !up) {
			events.push({ title: 'Service down', body: svc.name, severity: 'error' });
			set.push(serviceActivity(svc.name));
			clear.push(okId);
		} else if (was === false && up) {
			events.push({ title: 'Service recovered', body: svc.name, severity: 'ok' });
			clear.push(downId);
			set.push(recoveredActivity(svc.name));
		} else if (!known && !up) {
			events.push({ title: 'Service down', body: svc.name, severity: 'error' });
			set.push(serviceActivity(svc.name));
			clear.push(okId);
		}
	}

	return { prev: curr, events, set, clear, seed };
}

const DEFAULT_MAX = 4;

/** Ranked chips for the trough, with overflow collapsed into "N more". */
export function dockChips(activities, { max = DEFAULT_MAX } = {}) {
	const list = Array.isArray(activities) ? activities.filter(Boolean) : [];
	const ranked = [...list].sort((a, b) => {
		const bySev = severityRank(a.severity) - severityRank(b.severity);
		if (bySev !== 0) return bySev;
		return String(a.title || '').localeCompare(String(b.title || ''));
	});
	if (ranked.length <= max) return ranked;
	const head = ranked.slice(0, max - 1);
	const rest = ranked.slice(max - 1);
	return [
		...head,
		{
			id: 'stack',
			kind: 'stack',
			title: `${rest.length} more`,
			body: rest.map((a) => a.title).filter(Boolean).join(', '),
			severity: rest[0]?.severity || 'error'
		}
	];
}
