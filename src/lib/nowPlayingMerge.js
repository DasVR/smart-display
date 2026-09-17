import { isPlaybackJump, livePlaybackPosition } from './playbackClock.js';

export const OPTIMISTIC_HOLD_MS = 1200;

function sameTrack(a, b) {
	return (a?.title || '') === (b?.title || '') && (a?.artist || '') === (b?.artist || '');
}

function keepPlaybackClock(current, incoming) {
	return {
		...incoming,
		position: current.position,
		positionAt: current.positionAt,
		seeking: Boolean(current.seeking && incoming.seeking)
	};
}

/** Adopt metadata from `incoming` without letting a stale poll rewind the
 *  karaoke clock. A restamp of the last `prgr` / playerctl sample with a
 *  fresh `positionAt` would otherwise jump lyrics backward, then they would
 *  "catch up" on the next real progress report. A real scrub or skip must
 *  still land: same stored `position` + new `positionAt` is a restamp,
 *  a new `position` (or a flush that just cleared) is the player moving. */
export function adoptPlaybackClock(current, incoming, now = Date.now()) {
	if (!incoming) return current ?? null;
	if (!current) return incoming;
	if (!sameTrack(current, incoming)) return incoming;
	if (incoming.seeking) return incoming;
	if (Boolean(incoming.playing) !== Boolean(current.playing)) return incoming;

	const liveCur = livePlaybackPosition(current, now);
	const liveIn = livePlaybackPosition(incoming, now);
	const incomingPos = Number(incoming.position) || 0;
	const currentPos = Number(current.position) || 0;
	const sampleJumped = Math.abs(incomingPos - currentPos) > 0.2;
	const landedFromFlush = Boolean(current.seeking);

	// `pfls` then `prgr` (seeking cleared) is the landing. Take it even
	// when the new sample is behind the pre-seek clock.
	if (landedFromFlush) return incoming;

	// Dropped playerctl reads report 0 mid-track. AirPlay skip-to-start
	// is a real `prgr` near 0 and must land; playerctl zeros must not.
	const droppedZero =
		incoming.playing &&
		liveCur > 2 &&
		incomingPos < 0.45 &&
		incoming.source !== 'airplay';
	if (droppedZero) return keepPlaybackClock(current, incoming);

	if (sampleJumped) return incoming;

	// Same sample, newer stamp: the live clock is ahead of that restamp.
	if (liveIn < liveCur - 0.12) {
		return keepPlaybackClock(current, incoming);
	}

	return incoming;
}

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
	if (!holding) return adoptPlaybackClock(current, incoming, now);

	const sameTransport = incoming.playing === current.playing;
	if (sameTransport && !current.seeking) {
		return { ...adoptPlaybackClock(current, incoming, now), optimisticUntil: 0 };
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
