import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AIRPLAY_STALE_MS = 45_000;

function runtimeDir() {
	return process.env.XDG_RUNTIME_DIR || `/run/user/${typeof process.getuid === 'function' ? process.getuid() : 1000}`;
}

export function airplayStatePath() {
	if (process.env.AIRPLAY_NOWPLAYING_PATH) return process.env.AIRPLAY_NOWPLAYING_PATH;
	const dir = runtimeDir();
	return path.join(existsSync(dir) ? dir : os.tmpdir(), 'smart-display-airplay.json');
}

export function airplayArtPath() {
	if (process.env.AIRPLAY_ART_PATH) return process.env.AIRPLAY_ART_PATH;
	const dir = runtimeDir();
	return path.join(existsSync(dir) ? dir : os.tmpdir(), 'smart-display-airplay-art.jpg');
}

export function readAirplayNowPlaying(file = airplayStatePath(), now = Date.now()) {
	try {
		if (!existsSync(file)) return null;
		const data = JSON.parse(readFileSync(file, 'utf8'));
		if (!data || typeof data !== 'object') return null;
		const updatedAt = Number(data.updatedAt) || 0;
		if (updatedAt && now - updatedAt > AIRPLAY_STALE_MS) {
			return { ...data, playing: false, stale: true };
		}
		return data;
	} catch {
		return null;
	}
}

/** `mpris` here is BlueZ's AVRCP-backed MPRIS bridge for whatever phone is
 *  currently paired as a Bluetooth source - it's not a general desktop media
 *  player. BlueZ doesn't reliably tear down that MPRIS object's Status
 *  property when a phone disconnects ungracefully (it can keep reporting
 *  the last "Playing"/"Paused" state indefinitely), so `mpris` state is only
 *  trusted while `bluetoothConnected` confirms a device is actually there -
 *  otherwise a paused/playing track can get stuck on screen with nothing
 *  behind it. Defaults to `true` so callers that don't know connection
 *  state (tests, other call sites) keep the old behavior. */
export function mergeNowPlaying(mpris, airplay, { bluetoothConnected = true } = {}) {
	const airplaySession = Boolean(airplay && !airplay.stale && (airplay.playing || airplay.title));
	if (airplaySession) {
		const playing = Boolean(airplay.playing);
		return {
			playing,
			paused: Boolean(airplay.paused || (!playing && airplay.title)),
			artist: airplay.artist || 'Unknown artist',
			title: airplay.title || 'Unknown title',
			album: airplay.album || '',
			art: airplay.art || '',
			position: Number(airplay.position) || 0,
			positionAt: Number(airplay.positionAt) || 0,
			length: Number(airplay.length) || 0,
			updatedAt: Number(airplay.updatedAt) || 0,
			source: 'airplay',
			// True from a flush (skip/seek) until the next progress report
			// lands - tells the client's playback clock to hold position
			// still instead of extrapolating off a sample that's about to be
			// stale, which is what made scrubbing look like it desynced the
			// lyrics rather than just pausing them for a beat.
			seeking: Boolean(airplay.seeking)
		};
	}
	if (mpris && bluetoothConnected && (mpris.playing || mpris.title)) {
		return {
			...mpris,
			paused: Boolean(!mpris.playing && mpris.title),
			position: Number(mpris.position) || 0,
			positionAt: Number(mpris.positionAt) || 0,
			length: Number(mpris.length) || 0,
			source: mpris.source || 'mpris'
		};
	}
	return { playing: false };
}
