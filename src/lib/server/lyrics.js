const LYRICS_HIT_TTL = 6 * 60 * 60 * 1000;
const LYRICS_MISS_TTL = 90 * 1000;
const lyricsCache = new Map();

export function normalizeLyricText(value = '') {
	return String(value)
		.toLowerCase()
		.normalize('NFKD')
		.replace(/&/g, ' and ')
		.replace(/[^\w\s]/g, ' ')
		.replace(/\b(feat|ft|featuring|with)\b.*$/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function parseLRC(text) {
	const timeTag = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
	const lines = [];
	for (const raw of String(text || '').split('\n')) {
		const matches = [...raw.matchAll(timeTag)];
		if (!matches.length) continue;
		const content = raw.replace(timeTag, '').trim();
		for (const m of matches) {
			lines.push({ time: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: content });
		}
	}
	return lines.sort((a, b) => a.time - b.time);
}

export function scoreLyricsHit(hit, { artist, title, album, duration } = {}) {
	if (!hit) return 0;
	const wantTitle = normalizeLyricText(title);
	const wantArtist = normalizeLyricText(artist);
	const wantAlbum = normalizeLyricText(album);
	const gotTitle = normalizeLyricText(hit.trackName || hit.name || '');
	const gotArtist = normalizeLyricText(hit.artistName || '');
	const gotAlbum = normalizeLyricText(hit.albumName || '');
	if (!wantTitle || !gotTitle || gotTitle !== wantTitle) return 0;
	if (!wantArtist || !gotArtist) return 0;
	if (!(gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist))) return 0;

	let score = 70;
	if (gotArtist === wantArtist) score += 20;
	if (wantAlbum && gotAlbum === wantAlbum) score += 15;
	else if (wantAlbum && gotAlbum && (gotAlbum.includes(wantAlbum) || wantAlbum.includes(gotAlbum))) {
		score += 8;
	}
	const wantDur = Number(duration) || 0;
	const gotDur = Number(hit.duration) || 0;
	if (wantDur && gotDur) {
		const delta = Math.abs(wantDur - gotDur);
		if (delta <= 2) score += 20;
		else if (delta <= 8) score += 10;
		else if (delta > 30) score -= 40;
	}
	return score;
}

export function pickBestLyricsHit(hits, query) {
	const rows = Array.isArray(hits) ? hits : [];
	let best = null;
	let bestScore = 0;
	for (const hit of rows) {
		const score = scoreLyricsHit(hit, query);
		if (score > bestScore) {
			best = hit;
			bestScore = score;
		}
	}
	if (!best || bestScore < 70) return null;
	return best;
}

export function lyricsFromHit(hit) {
	if (!hit) return null;
	if (hit.syncedLyrics) return parseLRC(hit.syncedLyrics);
	if (hit.plainLyrics) return [{ time: 0, text: hit.plainLyrics }];
	return null;
}

export async function fetchLyrics(artist, title, { album = '', duration = 0, load } = {}) {
	const key = `${normalizeLyricText(artist)}|${normalizeLyricText(title)}|${normalizeLyricText(album)}|${Math.round(Number(duration) || 0)}`;
	const cached = lyricsCache.get(key);
	if (cached && Date.now() - cached.fetchedAt < cached.ttl) return cached.lines;
	const getJson = load || defaultLoad;
	try {
		const params = new URLSearchParams({ artist_name: artist, track_name: title });
		if (album) params.set('album_name', album);
		if (duration) params.set('duration', String(Math.round(duration)));
		const query = { artist, title, album, duration };
		let hit = null;
		try {
			hit = await getJson(`https://lrclib.net/api/get?${params}`);
			if (scoreLyricsHit(hit, query) < 70) hit = null;
		} catch {
			hit = null;
		}
		if (!hit) {
			const search = new URLSearchParams({ artist_name: artist, track_name: title });
			const found = await getJson(`https://lrclib.net/api/search?${search}`);
			hit = pickBestLyricsHit(found, query);
		}
		const lines = lyricsFromHit(hit);
		lyricsCache.set(key, { lines, fetchedAt: Date.now(), ttl: lines ? LYRICS_HIT_TTL : LYRICS_MISS_TTL });
		return lines;
	} catch (error) {
		console.error('lyrics fetch error:', error.message);
		lyricsCache.set(key, { lines: null, fetchedAt: Date.now(), ttl: LYRICS_MISS_TTL });
		return null;
	}
}

async function defaultLoad(url) {
	const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
	if (!r.ok) throw new Error(`lrclib ${r.status}`);
	return r.json();
}
