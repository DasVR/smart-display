import { nowPlaying } from '$lib/stores.js';

let inFlight = null;

/** Fetches /api/nowplaying and pushes the result into the shared store.
 *  Callers that raced in while a fetch was already inflight share its
 *  result instead of firing a redundant request. */
export async function refreshNowPlaying() {
	if (inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const r = await fetch('/api/nowplaying');
			if (r.ok) nowPlaying.set(await r.json());
		} catch {
			/* playerctl is optional */
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

/** Polls now-playing on an interval. Returns a stop function. */
export function startNowPlayingPolling(intervalMs = 1000) {
	refreshNowPlaying();
	const id = setInterval(refreshNowPlaying, intervalMs);
	return () => clearInterval(id);
}

/** Call right after a transport action (play/pause/skip) we issued
 *  ourselves, so the display catches up immediately instead of waiting for
 *  the next poll tick - some players (especially over Bluetooth AVRCP)
 *  need a beat to report the new state, so this refetches twice. */
export function nudgeNowPlaying() {
	refreshNowPlaying();
	setTimeout(refreshNowPlaying, 250);
}
