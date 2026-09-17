import { isPlaybackJump } from './playbackClock.js';

export const OPTIMISTIC_HOLD_MS = 1200;

/** Merge a freshly polled sample over the on-screen track. Disconnect
 *  always wins. Mid-hold, keep the optimistic transport/clock unless the
 *  server has actually landed on that seek (or matched play/pause). */
export function mergeNowPlayingSample(current, incoming, now = Date.now()) {
	if (!incoming) return current ?? null;
	if (!current) return incoming;

	const incomingLive = Boolean(incoming.playing || incoming.paused || incoming.title);
	if (!incomingLive) return incoming;

	const until = Number(current.optimisticUntil) || 0;
	const holding = until > now;
	if (!holding) return incoming;

	const sameTransport = incoming.playing === current.playing;
	if (sameTransport && !current.seeking) {
		return { ...incoming, optimisticUntil: 0 };
	}

	if (current.seeking) {
		const reported = Number(incoming.position) || 0;
		const target = Number(current.position) || 0;
		if (!incoming.seeking && Math.abs(reported - target) < 1.6) {
			return { ...incoming, optimisticUntil: 0 };
		}
		if (isPlaybackJump(current, incoming, now) && Math.abs(reported - target) < 1.6) {
			return { ...incoming, optimisticUntil: 0 };
		}
	}

	return {
		...incoming,
		playing: current.playing,
		paused: current.paused,
		position: current.position,
		positionAt: current.positionAt,
		seeking: current.seeking,
		optimisticUntil: until
	};
}
