/**
 * Session-history album carousel.
 *
 * AirPlay / MPRIS do not expose a real up-next queue, so the left/right
 * peek covers are tracks this kiosk has already seen. Skip-back restores
 * the song you left as `next`; a brand-new title truncates any future
 * slots the way a carousel should.
 */

export function trackKey(track) {
	if (!track) return '';
	return `${track.artist ?? ''}::${track.title ?? ''}`;
}

export function artEntry(track) {
	if (!track?.title) return null;
	return {
		key: trackKey(track),
		title: track.title || '',
		artist: track.artist || '',
		art: track.art || ''
	};
}

export function advanceArtRing(ring, index, track, { max = 8 } = {}) {
	const entry = artEntry(track);
	const list = Array.isArray(ring) ? ring.slice() : [];
	let i = Number.isInteger(index) ? index : -1;
	if (!entry) return { ring: list, index: i };

	if (i >= 0 && i < list.length && list[i]?.key === entry.key) {
		list[i] = { ...list[i], ...entry };
		return { ring: list, index: i };
	}

	const nextIdx = i + 1;
	if (nextIdx >= 0 && nextIdx < list.length && list[nextIdx]?.key === entry.key) {
		list[nextIdx] = { ...list[nextIdx], ...entry };
		return { ring: list, index: nextIdx };
	}

	const prevIdx = i - 1;
	if (prevIdx >= 0 && list[prevIdx]?.key === entry.key) {
		list[prevIdx] = { ...list[prevIdx], ...entry };
		return { ring: list, index: prevIdx };
	}

	if (i >= 0 && i < list.length - 1) {
		list.splice(i + 1);
	}
	list.push(entry);
	if (list.length > max) {
		list.splice(0, list.length - max);
	}
	return { ring: list, index: list.length - 1 };
}

export function artCarouselSlots(ring, index) {
	const list = Array.isArray(ring) ? ring : [];
	const i = Number.isInteger(index) ? index : -1;
	return {
		prev: i > 0 ? list[i - 1] : null,
		current: i >= 0 && i < list.length ? list[i] : null,
		next: i >= 0 && i + 1 < list.length ? list[i + 1] : null
	};
}

let session = { ring: [], index: -1 };

export function rememberNowPlaying(track) {
	session = advanceArtRing(session.ring, session.index, track);
	return artCarouselSlots(session.ring, session.index);
}

/** Where the current track sits in this session's history, for the
 *  "02 / 05" counter on the Music deck. Zero total before anything plays. */
export function artSessionPosition() {
	const total = session.ring.length;
	const i = session.index;
	return { position: i >= 0 && i < total ? i + 1 : 0, total };
}

export function resetArtCarousel() {
	session = { ring: [], index: -1 };
}
