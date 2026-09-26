import { isPlaybackJump } from '../playbackClock.js';

/** Decide when a now-playing sample is worth pushing over the websocket
 *  instead of waiting for the next client HTTP poll. Connect, disconnect,
 *  play/pause, skip, and scrub all fire immediately; ordinary clock
 *  advance does not (the client already extrapolates). */

export const NOWPLAYING_POLL_IDLE_MS = 1500;
export const NOWPLAYING_POLL_LIVE_MS = 400;
export const NOWPLAYING_POLL_SEEK_MS = 120;

export function isLiveNowPlaying(np) {
	return Boolean(np?.playing || np?.paused || np?.title);
}

export function compactNowPlaying(np) {
	if (!isLiveNowPlaying(np)) {
		return {
			playing: false,
			unavailable: Boolean(np?.unavailable),
			reason: np?.reason || ''
		};
	}
	return {
		playing: Boolean(np.playing),
		paused: Boolean(np.paused),
		artist: np.artist || '',
		title: np.title || '',
		album: np.album || '',
		art: np.art || '',
		position: Number(np.position) || 0,
		positionAt: Number(np.positionAt) || 0,
		length: Number(np.length) || 0,
		source: np.source || '',
		player: np.player || '',
		seeking: Boolean(np.seeking),
		lyricsPending: Boolean(np.lyricsPending),
		lyricsSource: np.lyricsSource || null,
		unavailable: Boolean(np.unavailable),
		degraded: np.degraded || null,
		reason: np.reason || ''
	};
}

/** Keep the on-screen session when playerctl fails, and carry the fault
 *  along so the display can say so instead of going blank. */
export function publishNowPlaying(prev, next) {
	if (!next) return prev && isLiveNowPlaying(prev) ? prev : { playing: false };
	if (next.unavailable && isLiveNowPlaying(prev)) {
		return {
			...prev,
			unavailable: true,
			reason: next.reason || 'failed',
			degraded: next.degraded || null
		};
	}
	return next;
}

export function nowPlayingPushKind(prev, next, now = Date.now()) {
	if (Boolean(next?.unavailable) !== Boolean(prev?.unavailable)) return 'fault';
	if ((prev?.degraded || '') !== (next?.degraded || '') && (prev?.degraded || next?.degraded)) return 'fault';
	const prevLive = isLiveNowPlaying(prev);
	const nextLive = isLiveNowPlaying(next);
	if (!prevLive && nextLive) return 'connect';
	if (prevLive && !nextLive) return 'disconnect';
	if (!nextLive) return null;
	if ((prev?.title || '') !== (next?.title || '') || (prev?.artist || '') !== (next?.artist || '')) {
		return 'track';
	}
	if (Boolean(prev?.playing) !== Boolean(next?.playing)) return 'transport';
	if (Boolean(prev?.seeking) !== Boolean(next?.seeking)) return 'seek';
	if (isPlaybackJump(prev || null, next, now)) return 'seek';
	return null;
}

export function nowPlayingPollMs(np) {
	if (np?.seeking) return NOWPLAYING_POLL_SEEK_MS;
	if (isLiveNowPlaying(np)) return NOWPLAYING_POLL_LIVE_MS;
	return NOWPLAYING_POLL_IDLE_MS;
}

export function nowPlayingPushPayload(np, kind) {
	const payload = compactNowPlaying(np);
	if (kind === 'track' || kind === 'connect') {
		payload.lyrics = np?.lyrics || null;
		payload.lyricsPending = Boolean(np?.lyricsPending);
		payload.lyricsSource = np?.lyricsSource || null;
	}
	return { type: 'nowPlaying', kind: kind || 'update', ...payload };
}
