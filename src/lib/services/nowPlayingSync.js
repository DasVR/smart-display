import { nowPlaying } from '$lib/stores.js';

let inFlight = null;

/** Fetches /api/nowplaying and pushes the result into the shared store,
 *  returning that result so callers (like the adaptive poll loop below) can
 *  react to it without a second request. Callers that raced in while a
 *  fetch was already inflight share its result instead of firing a
 *  redundant request. */
export async function refreshNowPlaying() {
	if (inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const r = await fetch('/api/nowplaying');
			if (!r.ok) return null;
			const data = await r.json();
			nowPlaying.set(data);
			return data;
		} catch {
			/* playerctl is optional */
			return null;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

// While a track is mid-seek (see the `seeking` flag in audioNowPlaying.js),
// poll much faster so the display picks up the post-seek position within a
// couple hundred milliseconds instead of waiting out the rest of a full
// 1s tick - that gap is what read as the lyrics "desyncing" on a scrub.
const SEEK_POLL_MS = 150;
const SEEK_BURST_MS = 4000;

/** Polls now-playing on an interval, self-adjusting to SEEK_POLL_MS for a
 *  short burst whenever the last response reported `seeking`. Returns a
 *  stop function. */
export function startNowPlayingPolling(intervalMs = 1000) {
	let stopped = false;
	let timer = 0;
	let seekUntil = 0;

	async function tick() {
		const data = await refreshNowPlaying();
		if (stopped) return;
		const now = Date.now();
		if (data?.seeking) seekUntil = now + SEEK_BURST_MS;
		const delay = now < seekUntil ? SEEK_POLL_MS : intervalMs;
		timer = setTimeout(tick, delay);
	}

	tick();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

/** Call right after a transport action (play/pause/skip) we issued
 *  ourselves, so the display catches up immediately instead of waiting for
 *  the next poll tick - some players (especially over Bluetooth AVRCP)
 *  need a beat to report the new state, so this refetches twice. */
export function nudgeNowPlaying() {
	refreshNowPlaying();
	setTimeout(refreshNowPlaying, 250);
}
