import { isPlaybackJump, isSeekingClock, livePlaybackPosition } from './playbackClock.js';

export const OPTIMISTIC_HOLD_MS = 1200;
/** After a kiosk scrub, keep the chosen clock until a nearby sample
 *  lands. Blindly taking the next poll used to treat leftover `seeking`
 *  as an AirPlay flush landing and extrapolate a stale `positionAt`
 *  about 10s past the scrub. */
const LOCAL_SEEK_NEAR_SEC = 1.6;
const STALE_LANDING_MS = 800;

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

function isLocalSeek(track) {
	return Boolean(track?.seeking) && Number(track?.optimisticUntil) > 0;
}

function nearSeekTarget(current, incoming) {
	const target = Number(current.position) || 0;
	const reported = Number(incoming.position) || 0;
	return Math.abs(reported - target) < LOCAL_SEEK_NEAR_SEC;
}

/** A landing sample's `position` is the playhead at receive time. If the
 *  stamp is seconds old, extrapolating it after a scrub runs lyrics past
 *  the place the user just picked. */
function restampLanding(incoming, now) {
	const at = Number(incoming.positionAt) || 0;
	const fresh = at && now - at <= STALE_LANDING_MS;
	return {
		...incoming,
		positionAt: fresh ? at : now,
		seeking: false,
		optimisticUntil: 0
	};
}

function holdLocalSeek(current, incoming) {
	return {
		...incoming,
		position: current.position,
		positionAt: current.positionAt,
		seeking: true,
		optimisticUntil: current.optimisticUntil
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
	if (incoming.seeking && isSeekingClock(incoming, now)) return incoming;
	if (Boolean(incoming.playing) !== Boolean(current.playing)) return incoming;

	const liveCur = livePlaybackPosition(current, now);
	const liveIn = livePlaybackPosition(incoming, now);
	const incomingPos = Number(incoming.position) || 0;
	const currentPos = Number(current.position) || 0;
	const sampleJumped = Math.abs(incomingPos - currentPos) > 0.2;
	const landedFromFlush = Boolean(current.seeking);
	const localSeek = isLocalSeek(current);

	// Kiosk scrub sets `seeking` plus `optimisticUntil`. That is not an
	// AirPlay `pfls` landing - a stale poll's old `positionAt` would run
	// the lyric clock ~10s past the scrub target.
	if (landedFromFlush && localSeek) {
		if (nearSeekTarget(current, incoming)) return restampLanding(incoming, now);
		return holdLocalSeek(current, incoming);
	}

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

function lyricsFingerprint(track) {
	const lines = track?.lyrics;
	if (!Array.isArray(lines) || !lines.length) return `${track?.lyricsSource || ''}:0`;
	const first = lines[0];
	const last = lines[lines.length - 1];
	return `${track.lyricsSource || ''}:${lines.length}:${first?.time}:${first?.text}:${last?.time}:${last?.text}`;
}

/** Keep the on-screen lyric array identity across polls that only restamp
 *  the same file, so the Music view does not reconcile hundreds of word
 *  spans every second. */
export function reuseLyrics(current, incoming) {
	if (!incoming || incoming.lyrics === current?.lyrics) return incoming;
	if (!incoming.lyrics && current?.lyrics && sameTrack(current, incoming)) {
		return {
			...incoming,
			lyrics: current.lyrics,
			lyricsSource: incoming.lyricsSource || current.lyricsSource,
			lyricsPending: incoming.lyricsPending ?? current.lyricsPending
		};
	}
	if (!current?.lyrics || !incoming.lyrics) return incoming;
	if (lyricsFingerprint(current) === lyricsFingerprint(incoming)) {
		return { ...incoming, lyrics: current.lyrics };
	}
	return incoming;
}

function withSessionHealth(track, incoming) {
	if (!track) return track;
	if (incoming?.unavailable) return track;
	return {
		...track,
		unavailable: false,
		degraded: incoming?.degraded || null,
		reason: incoming?.degraded ? incoming.reason || incoming.degraded : ''
	};
}

/** Merge a freshly polled sample over the on-screen track. Disconnect
 *  always wins. A failed probe (`unavailable`) keeps the session and raises
 *  the fault. Mid-hold, keep the optimistic transport/clock unless the
 *  server has actually landed on that seek (or matched play/pause). */
export function mergeNowPlayingSample(current, incoming, now = Date.now()) {
	if (!incoming) return current ?? null;
	if (incoming.unavailable) {
		if (!current || (!current.title && !current.playing && !current.paused)) return incoming;
		return {
			...current,
			unavailable: true,
			reason: incoming.reason || 'failed',
			degraded: incoming.degraded || null
		};
	}
	if (!current) return withSessionHealth(incoming, incoming);

	const incomingLive = Boolean(incoming.playing || incoming.paused || incoming.title);
	if (!incomingLive) return incoming;

	const until = Number(current.optimisticUntil) || 0;
	const holding = until > now;
	let merged;
	if (!holding) {
		merged = adoptPlaybackClock(current, incoming, now);
	} else {
		const sameTransport = incoming.playing === current.playing;
		if (sameTransport && !current.seeking) {
			merged = { ...adoptPlaybackClock(current, incoming, now), optimisticUntil: 0 };
		} else if (current.seeking) {
			if (!incoming.seeking && nearSeekTarget(current, incoming)) {
				merged = restampLanding(incoming, now);
			} else if (isPlaybackJump(current, incoming, now) && nearSeekTarget(current, incoming)) {
				merged = restampLanding(incoming, now);
			} else {
				merged = {
					...incoming,
					playing: current.playing,
					paused: current.paused,
					position: current.position,
					positionAt: current.positionAt,
					seeking: current.seeking,
					optimisticUntil: until
				};
			}
		} else {
			merged = {
				...incoming,
				playing: current.playing,
				paused: current.paused,
				position: current.position,
				positionAt: current.positionAt,
				seeking: current.seeking,
				optimisticUntil: until
			};
		}
	}
	return withSessionHealth(reuseLyrics(current, merged), incoming);
}
