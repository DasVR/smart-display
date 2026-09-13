const LYRICS_HIT_TTL = 6 * 60 * 60 * 1000;
const LYRICS_MISS_TTL = 90 * 1000;
const lyricsCache = new Map();

const LRCLIB_CLIENT = 'smart-display/1.0 (https://github.com/DasVR/smart-display)';
const TIME_TAG = /\[(\d{1,3}):(\d{2}(?:\.\d+)?)\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{2}(?:\.\d+)?)>/g;
const OFFSET_TAG = /\[offset:([+-]?\d+(?:\.\d+)?)\]/i;
const META_TAG = /^\s*\[(ar|ti|al|au|by|re|ve|length|tool|offset):/i;

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

function parseClock(minutes, seconds) {
	return parseInt(minutes, 10) * 60 + parseFloat(seconds);
}

function parseEnhancedWords(content, offsetSec) {
	const tags = [...String(content).matchAll(WORD_TAG)];
	if (!tags.length) return [];
	const words = [];
	for (let i = 0; i < tags.length; i++) {
		const start = tags[i].index + tags[i][0].length;
		const end = i + 1 < tags.length ? tags[i + 1].index : content.length;
		const text = content.slice(start, end).replace(WORD_TAG, '').trim();
		if (!text) continue;
		words.push({
			time: parseClock(tags[i][1], tags[i][2]) + offsetSec,
			text
		});
	}
	return words;
}

export function parseLRC(text) {
	let offsetSec = 0;
	const lines = [];
	for (const raw of String(text || '').split(/\r?\n/)) {
		const offsetMatch = raw.match(OFFSET_TAG);
		if (offsetMatch) {
			offsetSec = parseFloat(offsetMatch[1]) / 1000;
			continue;
		}
		if (META_TAG.test(raw)) continue;
		TIME_TAG.lastIndex = 0;
		const matches = [...raw.matchAll(TIME_TAG)];
		if (!matches.length) continue;
		const content = raw.replace(TIME_TAG, '');
		const words = parseEnhancedWords(content, offsetSec);
		const lineText = content.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
		if (!lineText && !words.length) continue;
		for (const m of matches) {
			lines.push({
				time: parseClock(m[1], m[2]) + offsetSec,
				text: lineText,
				...(words.length ? { words } : {})
			});
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

export function scoreItunesSong(hit, { artist, title, album } = {}) {
	if (!hit) return 0;
	const wantTitle = normalizeLyricText(title);
	const wantArtist = normalizeLyricText(artist);
	const wantAlbum = normalizeLyricText(album);
	const gotTitle = normalizeLyricText(hit.trackName || '');
	const gotArtist = normalizeLyricText(hit.artistName || '');
	const gotAlbum = normalizeLyricText(hit.collectionName || '');
	if (!wantTitle || !gotTitle || gotTitle !== wantTitle) return 0;
	if (!wantArtist || !gotArtist) return 0;
	if (!(gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist))) return 0;
	let score = 70;
	if (gotArtist === wantArtist) score += 20;
	if (wantAlbum && gotAlbum === wantAlbum) score += 15;
	else if (wantAlbum && gotAlbum && (gotAlbum.includes(wantAlbum) || wantAlbum.includes(gotAlbum))) {
		score += 8;
	}
	const millis = Number(hit.trackTimeMillis) || 0;
	if (millis > 0) score += 10;
	return score;
}

export function pickItunesDuration(results, query) {
	const rows = Array.isArray(results) ? results : [];
	let best = null;
	let bestScore = 0;
	for (const hit of rows) {
		const score = scoreItunesSong(hit, query);
		if (score > bestScore) {
			best = hit;
			bestScore = score;
		}
	}
	if (!best || bestScore < 70) return 0;
	const millis = Number(best.trackTimeMillis) || 0;
	return millis > 0 ? millis / 1000 : 0;
}

export async function lookupTrackDuration(artist, title, { album = '', load } = {}) {
	if (!artist || !title) return 0;
	const getJson = load || defaultLoad;
	try {
		const params = new URLSearchParams({
			term: `${artist} ${title}`,
			entity: 'song',
			limit: '8'
		});
		const data = await getJson(`https://itunes.apple.com/search?${params}`);
		return pickItunesDuration(data?.results, { artist, title, album });
	} catch {
		return 0;
	}
}

export async function fetchLyrics(artist, title, { album = '', duration = 0, load } = {}) {
	const rounded = Math.round(Number(duration) || 0);
	const key = `${normalizeLyricText(artist)}|${normalizeLyricText(title)}|${normalizeLyricText(album)}|${rounded}`;
	const cached = lyricsCache.get(key);
	if (cached && Date.now() - cached.fetchedAt < cached.ttl) return cached.lines;
	const getJson = load || defaultLoad;
	try {
		const params = new URLSearchParams({ artist_name: artist, track_name: title });
		if (album) params.set('album_name', album);
		if (rounded) params.set('duration', String(rounded));
		const query = { artist, title, album, duration: rounded };
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
	const r = await fetch(url, {
		signal: AbortSignal.timeout(4000),
		headers: {
			'User-Agent': LRCLIB_CLIENT,
			'Lrclib-Client': LRCLIB_CLIENT
		}
	});
	if (!r.ok) throw new Error(`lyrics ${r.status}`);
	return r.json();
}
