import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LYRICS_HIT_TTL = 6 * 60 * 60 * 1000;
const LYRICS_MISS_TTL = 90 * 1000;
const lyricsCache = new Map();

const SYNCEDLYRICS_SCRIPT = fileURLToPath(
	new URL('../../../scripts/forced_align/syncedlyrics_lookup.py', import.meta.url)
);

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

// Plain LRC (the overwhelming majority of what lrclib.net serves) only has
// one timestamp per line - no per-word data to drive the karaoke sweep.
// synthesizeWordTiming() below estimates it instead of falling back to
// highlighting the whole line at once.
const SYNTH_MAX_SPAN_SEC = 8;
const SYNTH_FALLBACK_WORDS_PER_SEC = 2.2;
const SYNTH_MIN_WORD_WEIGHT = 0.5;

/** Fills in an estimated `words` timing array for any line that doesn't
 *  already have real word-level data (from enhanced LRC, TTML, or
 *  Musixmatch rich-sync) - spreading the line's span (to the next line's
 *  clock, or a words-per-second estimate for a trailing line) across its
 *  words, weighted by word length so longer words get proportionally more
 *  time than "a" or "I" do. This is an estimate, not real per-word timing,
 *  but it's the same technique most lyric apps use for plain LRC and reads
 *  far better than snapping the whole line on at once. */
export function synthesizeWordTiming(lines) {
	const list = Array.isArray(lines) ? lines : [];
	return list.map((line, i) => {
		if (!line || line.words?.length || !line.text) return line;
		const tokens = line.text.split(/\s+/).filter(Boolean);
		if (tokens.length < 2) return line;
		const next = list[i + 1];
		const rawSpan =
			next && Number.isFinite(next.time) ? next.time - line.time : tokens.length / SYNTH_FALLBACK_WORDS_PER_SEC;
		const span = Math.max(0.4, Math.min(SYNTH_MAX_SPAN_SEC, rawSpan));
		const weights = tokens.map((t) => Math.max(SYNTH_MIN_WORD_WEIGHT, t.length));
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		let elapsed = 0;
		const words = tokens.map((text, idx) => {
			const time = line.time + elapsed;
			elapsed += (weights[idx] / totalWeight) * span;
			return { time, text };
		});
		return { ...line, words };
	});
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
		// A bare timestamp with no lyric content is how LRC marks an
		// instrumental break - kept (not skipped) so the UI can show a
		// "waiting for the next line" indicator instead of nothing.
		for (const m of matches) {
			lines.push({
				time: parseClock(m[1], m[2]) + offsetSec,
				text: lineText,
				...(words.length ? { words } : {})
			});
		}
	}
	return synthesizeWordTiming(lines.sort((a, b) => a.time - b.time));
}

/** Converts a TTML/SMPTE-ish timecode - plain seconds ("12.34" / "12.34s"),
 *  "MM:SS.mmm", or "HH:MM:SS.mmm" - to seconds. Returns null if unparsable. */
function parseTimecode(value) {
	if (value == null) return null;
	const str = String(value).trim();
	if (!str) return null;
	const secondsOnly = str.match(/^(\d+(?:\.\d+)?)s?$/);
	if (secondsOnly) return parseFloat(secondsOnly[1]);
	const parts = str.split(':');
	if (parts.length < 2 || parts.length > 3) return null;
	const nums = parts.map((p) => parseFloat(p));
	if (nums.some((n) => Number.isNaN(n))) return null;
	return nums.reduce((acc, n) => acc * 60 + n, 0);
}

function xmlAttr(attrsText, name) {
	const m = String(attrsText || '').match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
	return m ? m[1] : null;
}

function stripMarkup(html) {
	return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const TTML_P_TAG = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
const TTML_SPAN_TAG = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;

/** Parses Apple Music-style TTML (word/syllable spans inside timed <p>
 *  lines, e.g. `<span begin="00:01.230" end="00:01.540">word</span>`) into
 *  the same `{time, text, words}` shape `parseLRC` produces, so the lyrics
 *  UI doesn't need to know which source a line came from. A <p> with no
 *  spans and no text (an empty timed line) is kept as an instrumental
 *  marker, matching LRC's bare-timestamp convention. */
export function parseTTML(text) {
	const lines = [];
	TTML_P_TAG.lastIndex = 0;
	let m;
	while ((m = TTML_P_TAG.exec(String(text || ''))) !== null) {
		const [, pAttrs, inner] = m;
		const begin = parseTimecode(xmlAttr(pAttrs, 'begin'));
		if (begin == null) continue;
		const words = [];
		TTML_SPAN_TAG.lastIndex = 0;
		let sm;
		while ((sm = TTML_SPAN_TAG.exec(inner)) !== null) {
			const [, sAttrs, sInner] = sm;
			const wordBegin = parseTimecode(xmlAttr(sAttrs, 'begin'));
			const wordText = stripMarkup(sInner);
			if (wordBegin == null || !wordText) continue;
			words.push({ time: wordBegin, text: wordText });
		}
		const lineText = words.length ? words.map((w) => w.text).join(' ') : stripMarkup(inner);
		lines.push({ time: begin, text: lineText, ...(words.length ? { words } : {}) });
	}
	return lines.sort((a, b) => a.time - b.time);
}

/** Parses Musixmatch's rich-sync shape - an array of
 *  `{ ts, te, x, l: [{ c, o }] }` lines, where `ts` is the line's start
 *  time and each chunk's `o` is an offset in seconds from `ts` - into the
 *  same `{time, text, words}` shape as `parseLRC`/`parseTTML`. */
export function parseMusixmatchRichSync(body) {
	const rows = Array.isArray(body) ? body : [];
	const lines = [];
	for (const row of rows) {
		const ts = Number(row?.ts);
		if (!Number.isFinite(ts)) continue;
		const chunks = Array.isArray(row?.l) ? row.l : [];
		const words = [];
		for (const chunk of chunks) {
			const text = String(chunk?.c || '').trim();
			if (!text) continue;
			words.push({ time: ts + (Number(chunk?.o) || 0), text });
		}
		const lineText =
			typeof row?.x === 'string' && row.x.trim() ? row.x.trim() : words.map((w) => w.text).join(' ');
		lines.push({ time: ts, text: lineText, ...(words.length ? { words } : {}) });
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

function lyricsCacheKey(artist, title, album, rounded) {
	return `${normalizeLyricText(artist)}|${normalizeLyricText(title)}|${normalizeLyricText(album)}|${rounded}`;
}

/** Second lookup tier, tried only when lrclib.net has no hit. Shells out to
 *  `syncedlyrics_lookup.py`, a thin wrapper around the `syncedlyrics` pip
 *  package, which aggregates several other providers (NetEase, Musixmatch,
 *  ...) - it catches some tracks LRCLIB's own crowd-sourced database
 *  doesn't have. Resolves to `null` (never rejects) if the package isn't
 *  installed, nothing matched, or the lookup times out, since this is a
 *  best-effort tier the caller should silently fall through past. */
export function fetchSyncedLyricsFallback(artist, title, { spawnFn = spawn, pythonBin, timeoutMs = 15000 } = {}) {
	return new Promise((resolve) => {
		const bin = pythonBin || process.env.LYRICS_PYTHON_BIN || 'python3';
		let child;
		try {
			child = spawnFn(bin, [SYNCEDLYRICS_SCRIPT, artist, title], { stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			resolve(null);
			return;
		}
		let out = '';
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			try {
				child.kill('SIGKILL');
			} catch {
				/* already gone */
			}
			finish(null);
		}, timeoutMs);
		child.stdout?.on('data', (chunk) => {
			out += chunk;
		});
		child.on('error', () => finish(null));
		child.on('close', () => {
			try {
				const parsed = JSON.parse(out);
				finish(parsed?.synced ? parseLRC(parsed.synced) : null);
			} catch {
				finish(null);
			}
		});
	});
}

export async function fetchLyrics(artist, title, { album = '', duration = 0, load, spawnFn, pythonBin } = {}) {
	const rounded = Math.round(Number(duration) || 0);
	const key = lyricsCacheKey(artist, title, album, rounded);
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
		let lines = lyricsFromHit(hit);
		if (!lines) {
			lines = await fetchSyncedLyricsFallback(artist, title, { spawnFn, pythonBin });
		}
		lyricsCache.set(key, {
			lines,
			plainText: hit?.plainLyrics || null,
			fetchedAt: Date.now(),
			ttl: lines ? LYRICS_HIT_TTL : LYRICS_MISS_TTL
		});
		return lines;
	} catch (error) {
		console.error('lyrics fetch error:', error.message);
		lyricsCache.set(key, { lines: null, plainText: null, fetchedAt: Date.now(), ttl: LYRICS_MISS_TTL });
		return null;
	}
}

/** Plain (unsynced) lyric text for the forced-alignment fallback in
 *  forcedAlign.js - it needs the actual words to align against audio, even
 *  when nothing has synced timing for the track. Reuses fetchLyrics's own
 *  LRCLIB lookup/cache rather than querying twice. */
export async function fetchPlainLyricsText(artist, title, opts = {}) {
	const rounded = Math.round(Number(opts.duration) || 0);
	const key = lyricsCacheKey(artist, title, opts.album || '', rounded);
	const cached = lyricsCache.get(key);
	if (!cached || Date.now() - cached.fetchedAt >= cached.ttl) {
		await fetchLyrics(artist, title, opts);
	}
	return lyricsCache.get(key)?.plainText || null;
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
