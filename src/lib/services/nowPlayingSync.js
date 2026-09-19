import { nowPlaying } from '$lib/stores.js';
import { mergeNowPlayingSample, OPTIMISTIC_HOLD_MS } from '../nowPlayingMerge.js';

export { mergeNowPlayingSample, OPTIMISTIC_HOLD_MS };

let inFlight = null;

export const SEEK_POLL_MS = 150;
export const SEEK_BURST_MS = 4000;

let seekBurstUntil = 0;

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
			let merged = data;
			nowPlaying.update((cur) => {
				merged = mergeNowPlayingSample(cur, data);
				return merged;
			});
			return merged;
		} catch {
			/* playerctl is optional */
			return null;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

export function burstNowPlayingPoll(ms = SEEK_BURST_MS) {
	seekBurstUntil = Date.now() + ms;
}

/** Apply a websocket now-playing frame (connect / disconnect / scrub)
 *  without waiting for the HTTP poll. Compact frames omit lyrics; merge
 *  keeps the array already on screen for the same track. */
export function applyNowPlayingFrame(msg, now = Date.now()) {
	if (!msg || typeof msg !== 'object') return;
	const sample = { ...msg };
	delete sample.type;
	delete sample.kind;
	delete sample.from;
	if (sample.seeking || sample.playing === false) burstNowPlayingPoll();
	nowPlaying.update((cur) => mergeNowPlayingSample(cur, sample, now));
}

/** Keep a local play/pause/seek change on screen until the player reports
 *  the same transport, instead of letting the next 1s poll snap back. */
export function applyTransportOptimistic(patch, now = Date.now()) {
	if (patch && (patch.seeking || 'playing' in patch)) burstNowPlayingPoll();
	nowPlaying.update((cur) => {
		if (!cur) return cur;
		return { ...cur, ...patch, optimisticUntil: now + OPTIMISTIC_HOLD_MS };
	});
}

/** Polls now-playing on an interval, self-adjusting to SEEK_POLL_MS for a
 *  short burst whenever the last response reported `seeking`. Returns a
 *  stop function. */
export function startNowPlayingPolling(intervalMs = 2000) {
	let stopped = false;
	let timer = 0;

	async function tick() {
		const data = await refreshNowPlaying();
		if (stopped) return;
		const now = Date.now();
		if (data?.seeking) seekBurstUntil = now + SEEK_BURST_MS;
		const delay = now < seekBurstUntil || data?.seeking ? SEEK_POLL_MS : intervalMs;
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
