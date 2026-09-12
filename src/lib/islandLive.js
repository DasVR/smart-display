/**
 * Persistent Dynamic Island "Live Activities": compact statuses that stay
 * up while something is ongoing (now playing, a service that is down,
 * a dropped network), matching how iPhone keeps Music / Maps / a timer
 * in the island instead of only flashing a banner.
 *
 * Transient pings (service just died, then recovered) still go through
 * `pushIslandEvent` and expand the island; this module owns the compact
 * leftovers that remain after that slip dismisses.
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
 * Diff a telemetry service list into island events + compact activities.
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

		if (seed) {
			if (!up) set.push(serviceActivity(svc.name));
			continue;
		}

		if (was === true && !up) {
			events.push({ title: 'Service down', body: svc.name, severity: 'error', ttl: 8000 });
			set.push(serviceActivity(svc.name));
		} else if (was === false && up) {
			events.push({ title: 'Service recovered', body: svc.name, severity: 'ok', ttl: 5000 });
			clear.push(serviceActivityId(svc.name));
		} else if (!known && !up) {
			events.push({ title: 'Service down', body: svc.name, severity: 'error', ttl: 8000 });
			set.push(serviceActivity(svc.name));
		}
	}

	return { prev: curr, events, set, clear, seed };
}

function compactPeer(list) {
	if (list.length === 1) return list[0];
	const n = list.length;
	return {
		id: 'stack',
		kind: 'stack',
		title: n === 1 ? list[0].title : `${n} down`,
		body: list.map((a) => a.title).filter(Boolean).join(', '),
		severity: list[0]?.severity || 'error'
	};
}

/**
 * iPhone compact island is two sides around the camera: leading Live
 * Activity, trailing Live Activity (or an equalizer for Music).
 * Returns null when nothing ongoing, so the island can idle as a nub.
 */
export function compactSlots(nowPlaying, activities) {
	const list = Array.isArray(activities) ? activities.filter(Boolean) : [];
	const ranked = [...list].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
	const music = nowPlaying?.playing
		? {
				id: 'music',
				kind: 'music',
				title: nowPlaying.title || 'Untitled',
				body: nowPlaying.artist || '',
				art: nowPlaying.art || '',
				severity: 'info'
			}
		: null;

	if (music && ranked[0]) {
		return { leading: music, trailing: compactPeer(ranked) };
	}
	if (music) {
		return {
			leading: music,
			trailing: { id: 'eq', kind: 'eq', title: '', body: '', severity: 'info' }
		};
	}
	if (ranked.length === 1) {
		const only = ranked[0];
		return {
			leading: only,
			trailing: {
				id: `${only.id}:status`,
				kind: 'status',
				title: only.body || 'Live',
				body: '',
				severity: only.severity
			}
		};
	}
	if (ranked[0]) {
		return { leading: ranked[0], trailing: compactPeer(ranked.slice(1)) };
	}
	return null;
}
