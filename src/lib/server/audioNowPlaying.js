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

export function mergeNowPlaying(mpris, airplay) {
	const airplayLive = Boolean(airplay?.playing && !airplay.stale);
	if (airplayLive) {
		return {
			playing: true,
			artist: airplay.artist || 'Unknown artist',
			title: airplay.title || 'Unknown title',
			album: airplay.album || '',
			art: airplay.art || '',
			position: Number(airplay.position) || 0,
			length: Number(airplay.length) || 0,
			source: 'airplay'
		};
	}
	if (mpris && (mpris.playing || mpris.title)) {
		return { ...mpris, source: mpris.source || 'mpris' };
	}
	return { playing: false };
}
