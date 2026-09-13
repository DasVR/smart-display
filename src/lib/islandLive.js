/**
 * Persistent Dynamic Island "Live Activities": compact statuses that stay
 * up while something is ongoing (now playing, a dropped network),
 * matching how iPhone keeps Music / Maps / a timer in the island instead
 * of only flashing a banner.
 *
 * Transient pings still go through `pushIslandEvent` and expand the
 * island; this module owns the compact leftovers that remain after that
 * slip dismisses.
 */

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
	const music =
		nowPlaying?.playing || nowPlaying?.paused
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
