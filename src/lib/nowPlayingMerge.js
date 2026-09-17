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
 *  "catch up" on the next real progress report. */
export function adoptPlaybackClock(current, incoming, now = Date.now()) {
	if (!incoming) return current ?? null;
	if (!current) return incoming;
	if (!sameTrack(current, incoming)) return incoming;
	if (incoming.seeking) return incoming;

	const liveCur = livePlaybackPosition(current, now);
	const liveIn = livePlaybackPosition(incoming, now);
	const incomingPos = Number(incoming.position) || 0;

	// Dropped playerctl read (or a title-only AirPlay packet) looks like
	// "seek to 0" mid-song. Hold the running clock until a real sample.
	if (incoming.playing && liveCur > 2 && incomingPos < 0.45) {
		return keepPlaybackClock(current, incoming);
	}

	// Never rewind unless the player marked a flush/seek. Phone skip-back
	// arrives with `seeking: true` from AirPlay `pfls`.
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
