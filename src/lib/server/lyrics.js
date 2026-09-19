import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coalesceLyricWords, lineWithCoalescedWords } from '../lyricWords.js';
import { annotateLyricVoices } from '../lyricVoices.js';
import { getLyricPick, getLyricsRow, putLyricsRow } from './lyricsStore.js';

// Hits persist in data/lyrics.db (see lyricsStore.js). A karaoke-grade hit
// does not change, so it is kept for a year; a line-only hit is retried
// after a month in case a community source has since published word
// clocks. Misses stay memory-only and short so a flaky network never
// pins "no lyrics" to a track across restarts.
const LYRICS_WORD_LEVEL_TTL = 365 * 24 * 60 * 60 * 1000;
const LYRICS_HIT_TTL = 30 * 24 * 60 * 60 * 1000;
const LYRICS_MISS_TTL = 90 * 1000;

// Process-local L1 in front of the SQLite store: peekLyrics() is called on
// every now-playing poll, so the common case stays a Map lookup.
const lyricsCache = new Map();

function readLyricsEntry(key) {
	const hot = lyricsCache.get(key);
	if (hot) {
		if (Date.now() - hot.fetchedAt < hot.ttl) return hot;
		lyricsCache.delete(key);
	}
	const stored = getLyricsRow(key);
	if (!stored) return null;
	lyricsCache.set(key, stored);
	return stored;
}

function writeLyricsEntry(key, entry, { force = false } = {}) {
	if (!force) {
		const pick = getLyricPick(key);
		const existing = lyricsCache.get(key) || getLyricsRow(key);
		if (pick?.cacheSource && existing?.lines?.length) return;
	}
	lyricsCache.set(key, entry);
	if (entry.lines) putLyricsRow(key, entry);
}

/** Store a chosen provider as this track's lyrics cache row so later polls
 *  keep it even if a community refetch would have overwritten it. */
export function seedLyricsCache(artist, title, { album = '', duration = 0, source, lines, wordLevel, plainText, plainSource } = {}) {
	if (!Array.isArray(lines) || !lines.length) return false;
	const rounded = Math.round(Number(duration) || 0);
	const key = lyricsCacheKey(artist, title, album, rounded);
	writeLyricsEntry(
		key,
		{
			artist,
			title,
			album,
			duration: rounded,
			source: source || null,
			wordLevel: Boolean(wordLevel) || hasRealWordTiming(lines),
			lines,
			plainText: plainText || lyricsToPlainText(lines),
			plainSource: plainSource || null,
			fetchedAt: Date.now(),
			ttl: LYRICS_WORD_LEVEL_TTL
		},
		{ force: true }
	);
	return true;
}

const SYNCEDLYRICS_SCRIPT = fileURLToPath(
	new URL('../../../scripts/forced_align/syncedlyrics_lookup.py', import.meta.url)
);

const CANONICAL_SCRIPT = fileURLToPath(
	new URL('../../../scripts/forced_align/canonical_lyrics.py', import.meta.url)
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

// NetEase/Kugou (and some LRC dumps) stamp a header row before the song:
// "作词: …", "Title - Artist". Those are credits, not lyrics.
export const CREDIT_LINE_RE =
	/^(作词|作詞|作曲|编曲|編曲|制作人|製作人|歌词|歌詞|演唱|歌手|出品|produced\s*by|written\s*by|lyrics\s*by|lyricist|composer|arranger|lyrics|composer)\s*[:：]/i;

/** End-of-file stamps community files append after the last sung line.
 *  Whole-line only for "The end" / "End." so a verse like Sinatra's
 *  "The end is near" stays. Marks (©) and catalog watermarks can sit
 *  anywhere on the line. */
export const TRAILING_CREDIT_RE =
	/^(lrc\s*by|lyrics\s+provided|provided\s+by|copyright|all rights reserved|thanks for listening)\b/i;
const WHOLE_LINE_CREDIT_RE = /^(the end|end|fin)\.?$/i;
const MARK_CREDIT_RE = /©|℗|网易云|酷狗音乐|qq音乐/;

function isTrackHeaderLine(text, query = {}) {
	const n = normalizeLyricText(text);
	const title = normalizeLyricText(query.title);
	const artist = normalizeLyricText(query.artist);
	if (!n || !title) return false;
	if (n === title) return true;
	if (artist && (n === `${title} ${artist}` || n === `${artist} ${title}`)) return true;
	if (artist && n.startsWith(title) && n.endsWith(artist) && n.length > title.length + artist.length) {
		return true;
	}
	return false;
}

/** Drops credit/title header rows so they never show as karaoke. Blank
 *  instrumental markers stay. Exact-title-only matches only drop when they
 *  sit at the start of the file (a chorus that repeats the title later is
 *  a real lyric). "Title - Artist" headers drop wherever they appear.
 *  Trailing provider stamps after the last sung line also drop. */
export function isTrailingCreditLine(text) {
	const raw = String(text || '').trim();
	if (!raw) return false;
	if (CREDIT_LINE_RE.test(raw) || TRAILING_CREDIT_RE.test(raw)) return true;
	if (WHOLE_LINE_CREDIT_RE.test(raw)) return true;
	return MARK_CREDIT_RE.test(raw);
}

export function dropNonLyricLines(lines, query = {}) {
	const list = Array.isArray(lines) ? lines : [];
	const kept = list.filter((line) => {
		const text = String(line?.text || '').trim();
		if (!text) return true;
		if (isTrailingCreditLine(text)) return false;
		if (!isTrackHeaderLine(text, query)) return true;
		const n = normalizeLyricText(text);
		const title = normalizeLyricText(query.title);
		const artist = normalizeLyricText(query.artist);
		if (artist && n !== title) return false;
		return (Number(line.time) || 0) >= 3;
	});
	while (kept.length && isTrailingCreditLine(kept[kept.length - 1]?.text)) {
		kept.pop();
	}
	return annotateLyricVoices(kept);
}

function timedWord(time, text, end) {
	const word = { time, text };
	if (Number.isFinite(end) && end > time) word.end = end;
	return word;
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
		const time = parseClock(tags[i][1], tags[i][2]) + offsetSec;
		const nextTime =
			i + 1 < tags.length ? parseClock(tags[i + 1][1], tags[i + 1][2]) + offsetSec : undefined;
		words.push(timedWord(time, text, nextTime));
	}
	return coalesceLyricWords(words);
}

// Plain LRC (the overwhelming majority of what lrclib.net serves) only has
// one timestamp per line - no per-word data to drive the karaoke sweep.
// synthesizeWordTiming() below estimates it instead of falling back to
// highlighting the whole line at once.
const SYNTH_MAX_SPAN_SEC = 8;
const SYNTH_FALLBACK_WORDS_PER_SEC = 2.2;
const SYNTH_MIN_WORD_WEIGHT = 0.6;
// A word ending a clause reads with a small breath after it before the next
// one starts - this bonus (added on top of its syllable weight) buys that
// word's tail a sliver more time instead of running straight into the next.
const SYNTH_CLAUSE_PAUSE_BONUS = 0.6;
const CLAUSE_END_RE = /[,.;:!?]$/;
const VOWEL_GROUPS_RE = /[aeiouy]+/g;

/** Rough syllable count for a word, via the standard "count vowel groups,
 *  drop a silent trailing e" heuristic - not linguistically exact, but a
 *  much closer proxy for how long a word takes to sing/say than its raw
 *  character count (e.g. "screamed" is one syllable despite being longer
 *  than "melody"'s three). */
function estimateSyllables(word) {
	const letters = String(word || '')
		.toLowerCase()
		.replace(/[^a-z]/g, '');
	if (!letters) return 1;
	let count = (letters.match(VOWEL_GROUPS_RE) || []).length;
	if (count > 1 && letters.endsWith('e') && !letters.endsWith('le')) count -= 1;
	return Math.max(1, count);
}

/** Fills in an estimated `words` timing array for any line that doesn't
 *  already have real word-level data (from enhanced LRC, TTML, or
 *  Musixmatch rich-sync) - spreading the line's span (to the next line's
 *  clock, or a words-per-second estimate for a trailing line) across its
 *  words, weighted by estimated syllable count (plus a small pause bonus for
 *  a word ending a clause) so the sweep reads like actual speech rhythm
 *  rather than a raw-character-count guess. This is an estimate, not real
 *  per-word timing, but it's the same technique most lyric apps use for
 *  plain LRC and reads far better than snapping the whole line on at once. */
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
		const weights = tokens.map((t) => {
			const weight = estimateSyllables(t) + (CLAUSE_END_RE.test(t) ? SYNTH_CLAUSE_PAUSE_BONUS : 0);
			return Math.max(SYNTH_MIN_WORD_WEIGHT, weight);
		});
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		let elapsed = 0;
		const words = tokens.map((text, idx) => {
			const time = line.time + elapsed;
			elapsed += (weights[idx] / totalWeight) * span;
			return { ...timedWord(time, text, line.time + elapsed), estimated: true };
		});
		return { ...line, end: line.time + span, words };
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
	return dropNonLyricLines(synthesizeWordTiming(lines.sort((a, b) => a.time - b.time)));
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

function decodeLyricChunk(html) {
	return String(html || '')
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&apos;|&#39;|&#x27;/gi, "'")
		.replace(/&lsquo;|&rsquo;|&#8216;|&#8217;/gi, "'")
		.replace(/&quot;|&#34;/gi, '"')
		.replace(/&amp;/gi, '&');
}

function stripMarkup(html) {
	return decodeLyricChunk(html).replace(/\s+/g, ' ').trim();
}

const TTML_P_TAG = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
const SPAN_OPEN_RE = /<span\b([^>]*)>/i;
const SPAN_CLOSE_RE = /<\/span\s*>/i;

function ttmlRole(attrs) {
	return xmlAttr(attrs, 'ttm:role') || xmlAttr(attrs, 'role');
}

function ttmlAgent(attrs) {
	return xmlAttr(attrs, 'ttm:agent') || xmlAttr(attrs, 'itunes:agent') || xmlAttr(attrs, 'agent');
}

/** Top-level `<span>` nodes, including nested ones, with source offsets so
 *  we can see the whitespace between words. A naive non-greedy regex stops
 *  at the first `</span>` and drops Apple Music `x-bg` wrappers. */
function extractTopLevelSpans(html) {
	const src = String(html || '');
	const out = [];
	let i = 0;
	while (i < src.length) {
		const slice = src.slice(i);
		const open = slice.match(SPAN_OPEN_RE);
		if (!open) break;
		const abs = i + open.index;
		const attrs = open[1];
		let depth = 1;
		let pos = abs + open[0].length;
		const contentStart = pos;
		while (pos < src.length && depth > 0) {
			const rest = src.slice(pos);
			const nextOpen = rest.search(/<span\b/i);
			const nextClose = rest.search(SPAN_CLOSE_RE);
			if (nextClose < 0) {
				pos = src.length;
				break;
			}
			if (nextOpen >= 0 && nextOpen < nextClose) {
				const openTag = rest.slice(nextOpen).match(SPAN_OPEN_RE);
				depth += 1;
				pos += nextOpen + (openTag ? openTag[0].length : 6);
			} else {
				const closeTag = rest.slice(nextClose).match(SPAN_CLOSE_RE);
				const closeLen = closeTag ? closeTag[0].length : 7;
				depth -= 1;
				if (depth === 0) {
					out.push({
						attrs,
						inner: src.slice(contentStart, pos + nextClose),
						start: abs,
						end: pos + nextClose + closeLen
					});
					i = pos + nextClose + closeLen;
					break;
				}
				pos += nextClose + closeLen;
			}
		}
		if (depth > 0) break;
	}
	return out;
}

function collectTimedWords(html) {
	const src = String(html || '');
	const words = [];
	let cursor = 0;
	for (const span of extractTopLevelSpans(src)) {
		const between = src.slice(cursor, span.start);
		cursor = span.end;
		const role = ttmlRole(span.attrs);
		if (role === 'x-translation' || role === 'x-bg') continue;
		const nested = extractTopLevelSpans(span.inner);
		if (nested.length) {
			words.push(...collectTimedWords(span.inner));
			continue;
		}
		const wordBegin = parseTimecode(xmlAttr(span.attrs, 'begin'));
		const wordEnd = parseTimecode(xmlAttr(span.attrs, 'end'));
		const raw = decodeLyricChunk(span.inner);
		const wordText = raw.replace(/\s+/g, ' ').trim();
		if (wordBegin == null || !wordText) continue;
		const breakBefore = /\s/.test(decodeLyricChunk(between)) || /^\s/.test(raw);
		words.push({
			...timedWord(wordBegin, wordText, wordEnd),
			...(breakBefore ? { breakBefore: true } : {})
		});
	}
	return words;
}

function backgroundPartFromSpan(span) {
	const words = coalesceLyricWords(collectTimedWords(span.inner));
	const text = words.length ? words.map((w) => w.text).join(' ') : stripMarkup(span.inner);
	if (!text) return null;
	const begin = parseTimecode(xmlAttr(span.attrs, 'begin')) ?? (words.length ? words[0].time : null);
	const lastEnd = words.length ? Number(words[words.length - 1].end) : null;
	const end = parseTimecode(xmlAttr(span.attrs, 'end')) ?? (Number.isFinite(lastEnd) ? lastEnd : null);
	const part = { time: begin ?? 0, text };
	if (Number.isFinite(end) && end > part.time) part.end = end;
	if (words.length) part.words = words;
	return part;
}

function collectBackgroundParts(html) {
	const parts = [];
	for (const span of extractTopLevelSpans(html)) {
		const role = ttmlRole(span.attrs);
		if (role === 'x-translation') continue;
		if (role === 'x-bg') {
			const part = backgroundPartFromSpan(span);
			if (part) parts.push(part);
			continue;
		}
		parts.push(...collectBackgroundParts(span.inner));
	}
	return parts;
}

/** Apple / AMLL TTML uses a top-level `<br/>` inside a timed `<p>` to put
 *  a second vocal row under the lead (often without `ttm:role="x-bg"`).
 *  Nested `<br/>` inside a span is just a space, not a row split. */
function splitTopLevelByBr(html) {
	const src = String(html || '');
	if (!src) return [''];
	const spans = extractTopLevelSpans(src);
	const insideSpan = (idx) => spans.some((s) => idx >= s.start && idx < s.end);
	const rows = [];
	let last = 0;
	const brRe = /<br\s*\/?>/gi;
	let m;
	while ((m = brRe.exec(src)) !== null) {
		if (insideSpan(m.index)) continue;
		rows.push(src.slice(last, m.index));
		last = m.index + m[0].length;
	}
	rows.push(src.slice(last));
	return rows;
}

function rowToBackgroundParts(html, fallbackTime) {
	const src = String(html || '');
	const nestedBg = collectBackgroundParts(src);
	const words = coalesceLyricWords(collectTimedWords(src));
	if (!words.length) {
		if (nestedBg.length) return nestedBg;
		const text = stripMarkup(src);
		if (!text) return [];
		return [{ time: Number(fallbackTime) || 0, text }];
	}
	const lastEnd = Number(words[words.length - 1].end);
	const part = {
		time: words[0].time,
		text: words.map((w) => w.text).join(' ')
	};
	if (Number.isFinite(lastEnd) && lastEnd > part.time) part.end = lastEnd;
	part.words = words;
	return [part, ...nestedBg];
}

/** Parses Apple Music-style TTML (word/syllable spans inside timed <p>
 *  lines, e.g. `<span begin="00:01.230" end="00:01.540">word</span>`) into
 *  the same `{time, text, words}` shape `parseLRC` produces, so the lyrics
 *  UI doesn't need to know which source a line came from. A <p> with no
 *  spans and no text (an empty timed line) is kept as an instrumental
 *  marker, matching LRC's bare-timestamp convention. Background vocals
 *  (`ttm:role="x-bg"`) and top-level `<br/>` rows stay attached under the
 *  lead line instead of merging into its karaoke sweep. */
export function parseTTML(text) {
	const lines = [];
	TTML_P_TAG.lastIndex = 0;
	let m;
	while ((m = TTML_P_TAG.exec(String(text || ''))) !== null) {
		const [, pAttrs, inner] = m;
		const begin = parseTimecode(xmlAttr(pAttrs, 'begin'));
		if (begin == null) continue;
		const lineEnd = parseTimecode(xmlAttr(pAttrs, 'end'));
		const agent = ttmlAgent(pAttrs);
		const rows = splitTopLevelByBr(inner);
		const leadHtml = rows[0] ?? inner;
		const words = coalesceLyricWords(collectTimedWords(leadHtml));
		const background = [
			...collectBackgroundParts(leadHtml),
			...rows.slice(1).flatMap((row) => rowToBackgroundParts(row, begin))
		];
		const lineText = words.length ? words.map((w) => w.text).join(' ') : stripMarkup(leadHtml);
		lines.push({
			time: begin,
			text: lineText,
			...(lineEnd != null && lineEnd > begin ? { end: lineEnd } : {}),
			...(agent ? { agent } : {}),
			...(words.length ? { words } : {}),
			...(background.length ? { background } : {})
		});
	}
	return annotateLyricVoices(lines.sort((a, b) => a.time - b.time));
}

/** Parses Musixmatch's rich-sync shape - an array of
 *  `{ ts, te, x, l: [{ c, o }] }` lines, where `ts` is the line's start
 *  time and each chunk's `o` is an offset in seconds from `ts` - into the
 *  same `{time, text, words}` shape as `parseLRC`/`parseTTML`. */
const YRC_WORD_RE = /\((\d+),(\d+),(\d+)\)([^(]*)/g;
const KRC_LINE_RE = /^\[(\d+),(\d+)\](.*)$/;
const KRC_WORD_RE = /<(\d+),(\d+),(\d+)>([^<]*)/g;

/** NetEase YRC: JSON-per-line credits (`{t,c:[{tx,t}]}`) mixed with
 *  `[startMs,durMs](start,dur,0)word` karaoke rows. */
export function parseYrc(text) {
	const lines = [];
	for (const raw of String(text || '').split(/\r?\n/)) {
		const row = raw.trim();
		if (!row) continue;
		if (row.startsWith('{')) {
			try {
				const obj = JSON.parse(row);
				const begin = (Number(obj?.t) || 0) / 1000;
				const words = [];
				for (const chunk of obj?.c || []) {
					const word = String(chunk?.tx || chunk?.c || '');
					if (!word) continue;
					words.push({ time: begin + (Number(chunk?.t) || 0) / 1000, text: word });
				}
				const coalesced = coalesceLyricWords(words);
				const lineText = coalesced.map((w) => w.text).join(' ');
				if (!lineText || CREDIT_LINE_RE.test(lineText)) continue;
				lines.push({
					time: begin,
					text: lineText,
					...(coalesced.length ? { words: coalesced } : {})
				});
			} catch {
				/* not a JSON credit line */
			}
			continue;
		}
		const header = row.match(/^\[(\d+),(\d+)\](.*)$/);
		if (!header) continue;
		const begin = Number(header[1]) / 1000;
		const lineEnd = begin + Number(header[2]) / 1000;
		const words = [];
		YRC_WORD_RE.lastIndex = 0;
		let wm;
		while ((wm = YRC_WORD_RE.exec(header[3])) !== null) {
			const word = wm[4].trim();
			if (!word) continue;
			const time = Number(wm[1]) / 1000;
			words.push(timedWord(time, word, time + Number(wm[2]) / 1000));
		}
		const coalesced = coalesceLyricWords(words);
		const lineText = coalesced.map((w) => w.text).join(' ');
		if (CREDIT_LINE_RE.test(lineText)) continue;
		lines.push(
			lineWithCoalescedWords({
				time: begin,
				end: lineEnd,
				text: lineText,
				...(coalesced.length ? { words: coalesced } : {})
			})
		);
	}
	return lines.sort((a, b) => a.time - b.time);
}

/** Decoded Kugou KRC: `[startMs,durMs]<offsetMs,dur,0>word`. */
export function parseKrc(text) {
	const lines = [];
	for (const raw of String(text || '').split(/\r?\n/)) {
		const match = raw.match(KRC_LINE_RE);
		if (!match) continue;
		const begin = Number(match[1]) / 1000;
		const lineEnd = begin + Number(match[2]) / 1000;
		const words = [];
		KRC_WORD_RE.lastIndex = 0;
		let wm;
		while ((wm = KRC_WORD_RE.exec(match[3])) !== null) {
			const word = wm[4].trim();
			if (!word) continue;
			const time = begin + Number(wm[1]) / 1000;
			words.push(timedWord(time, word, time + Number(wm[2]) / 1000));
		}
		const coalesced = coalesceLyricWords(words);
		const lineText = coalesced.length
			? coalesced.map((w) => w.text).join(' ')
			: match[3].replace(KRC_WORD_RE, '').trim();
		if (CREDIT_LINE_RE.test(lineText)) continue;
		lines.push(
			lineWithCoalescedWords({
				time: begin,
				end: lineEnd,
				text: lineText,
				...(coalesced.length ? { words: coalesced } : {})
			})
		);
	}
	return lines.sort((a, b) => a.time - b.time);
}

/** True when at least one line has real (not length-estimated) word clocks
 *  from TTML / YRC / KRC / enhanced LRC. SynthesizeWordTiming marks its
 *  guesses with `estimated: true` so we can still kick on-device alignment
 *  for plain/line-only hits. */
export function hasRealWordTiming(lines) {
	if (!Array.isArray(lines)) return false;
	return lines.some((line) => {
		const words = line?.words;
		if (!Array.isArray(words) || words.length < 2) return false;
		return words.every((word) => word && !word.estimated);
	});
}

/** Qwen (a speech aligner) often stamps a whole verse at one clock, then
 *  jumps. That still has `words[]`, so hasRealWordTiming is true, but the
 *  karaoke is unusable. Community word-sync should win in that case. */
export function isCollapsedAlignment(lines) {
	if (!Array.isArray(lines) || !lines.length) return false;
	const stamps = [];
	let flat = 0;
	for (const line of lines) {
		const words = Array.isArray(line?.words) ? line.words : [];
		for (const word of words) {
			if (!word || word.estimated) continue;
			const t = Number(word.time);
			if (!Number.isFinite(t)) continue;
			stamps.push(t);
			const end = Number(word.end);
			if (!Number.isFinite(end) || end - t <= 0.02) flat += 1;
		}
	}
	if (stamps.length < 8) return false;
	const unique = new Set(stamps.map((t) => Math.round(t * 10) / 10));
	if (unique.size / stamps.length < 0.25) return true;
	return flat / stamps.length > 0.6;
}

export function lyricsToPlainText(lines) {
	if (!Array.isArray(lines)) return null;
	const texts = lines.map((line) => String(line?.text || '').trim()).filter(Boolean);
	return texts.length ? texts.join('\n') : null;
}

export function linesFromCommunityPayload(parsed, query) {
	if (!parsed || typeof parsed !== 'object') return null;
	const q = query || { artist: parsed.artist, title: parsed.title };
	let lines = null;
	if (Array.isArray(parsed.lines) && parsed.lines.length) {
		lines = parsed.wordLevel
			? parsed.lines.map(lineWithCoalescedWords)
			: synthesizeWordTiming(parsed.lines);
	} else if (parsed.ttml) {
		const parsedTtml = parseTTML(parsed.ttml);
		lines = parsedTtml.length ? synthesizeWordTiming(parsedTtml) : null;
	} else if (parsed.yrc) {
		const parsedYrc = parseYrc(parsed.yrc);
		lines = parsedYrc.length ? synthesizeWordTiming(parsedYrc) : null;
	} else if (parsed.krc) {
		const parsedKrc = parseKrc(parsed.krc);
		lines = parsedKrc.length ? synthesizeWordTiming(parsedKrc) : null;
	} else if (parsed.synced) {
		lines = parseLRC(parsed.synced);
	}
	if (!lines) return null;
	const cleaned = dropNonLyricLines(lines, q);
	return cleaned.length ? cleaned : null;
}

export function parseMusixmatchRichSync(body) {
	const rows = Array.isArray(body) ? body : [];
	const lines = [];
	for (const row of rows) {
		const ts = Number(row?.ts);
		if (!Number.isFinite(ts)) continue;
		const chunks = Array.isArray(row?.l) ? row.l : [];
		const te = Number(row?.te);
		const words = [];
		for (let i = 0; i < chunks.length; i++) {
			const text = String(chunks[i]?.c || '').trim();
			if (!text) continue;
			const time = ts + (Number(chunks[i]?.o) || 0);
			const next = chunks[i + 1];
			const end = next ? ts + (Number(next.o) || 0) : te;
			words.push(timedWord(time, text, end));
		}
		const lineText =
			typeof row?.x === 'string' && row.x.trim() ? row.x.trim() : words.map((w) => w.text).join(' ');
		lines.push(
			lineWithCoalescedWords({
				time: ts,
				text: lineText,
				...(Number.isFinite(te) && te > ts ? { end: te } : {}),
				...(words.length ? { words } : {})
			})
		);
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

export function lyricsFromHit(hit, query) {
	if (!hit) return null;
	const q = query || { artist: hit.artistName, title: hit.trackName };
	if (hit.syncedLyrics) return dropNonLyricLines(parseLRC(hit.syncedLyrics), q);
	if (hit.plainLyrics) return dropNonLyricLines([{ time: 0, text: hit.plainLyrics }], q);
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

const DURATION_TTL = 6 * 60 * 60 * 1000;
const durationCache = new Map();
const durationInFlight = new Set();

function durationCacheKey(artist, title, album) {
	return `${normalizeLyricText(artist)}|${normalizeLyricText(title)}|${normalizeLyricText(album)}`;
}

/** Synchronous read of a previously-resolved track duration, or `undefined`
 *  if it hasn't been looked up yet (distinct from a confirmed 0). Exists so
 *  getNowPlaying() can use a duration the moment it's known without ever
 *  awaiting the iTunes lookup inline - see ensureTrackDurationCached(). */
export function peekTrackDuration(artist, title, album = '') {
	const cached = durationCache.get(durationCacheKey(artist, title, album));
	if (!cached || Date.now() - cached.fetchedAt >= DURATION_TTL) return undefined;
	return cached.duration;
}

/** Kicks off (at most once per track, de-duplicated across overlapping
 *  polls) a background lookupTrackDuration() call and caches the result -
 *  never awaited by the caller, so a cold cache never adds iTunes's
 *  round-trip to a now-playing response's latency. The duration just shows
 *  up a poll or two later via peekTrackDuration(). */
export function ensureTrackDurationCached(artist, title, opts = {}) {
	const key = durationCacheKey(artist, title, opts.album || '');
	if (durationInFlight.has(key) || peekTrackDuration(artist, title, opts.album) !== undefined) return;
	durationInFlight.add(key);
	lookupTrackDuration(artist, title, opts)
		.then((duration) => durationCache.set(key, { duration, fetchedAt: Date.now() }))
		.catch(() => {})
		.finally(() => durationInFlight.delete(key));
}

export function lyricsCacheKey(artist, title, album, rounded) {
	return `${normalizeLyricText(artist)}|${normalizeLyricText(title)}|${normalizeLyricText(album)}|${rounded}`;
}

/** Community lookup: AMLL TTML, NetEase YRC, Kugou KRC, then the
 *  syncedlyrics package (Musixmatch enhanced / line LRC). Resolves to
 *  `{ lines, plain, source, wordLevel }` or null. Never rejects. */
export function fetchCommunityLyrics(
	artist,
	title,
	{ album = '', duration = 0, spawnFn = spawn, pythonBin, timeoutMs = 22000 } = {}
) {
	return new Promise((resolve) => {
		const bin = pythonBin || process.env.LYRICS_PYTHON_BIN || 'python3';
		let child;
		try {
			child = spawnFn(
				bin,
				[SYNCEDLYRICS_SCRIPT, artist, title, album || '', String(Math.round(Number(duration) || 0))],
				{ stdio: ['ignore', 'pipe', 'ignore'] }
			);
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
				const lines = linesFromCommunityPayload(parsed, { artist, title });
				if (!lines) {
					finish(null);
					return;
				}
				finish({
					lines,
					plain: parsed.plain || lyricsToPlainText(lines),
					source: parsed.source || null,
					wordLevel: Boolean(parsed.wordLevel) || hasRealWordTiming(lines)
				});
			} catch {
				finish(null);
			}
		});
	});
}

/** Genius (if GENIUS_ACCESS_TOKEN + lyricsgenius) else LRCLIB plainLyrics.
 *  This is the lyric *sheet* the singing aligner times against. Never rejects. */
export function fetchCanonicalLyrics(
	artist,
	title,
	{ album = '', duration = 0, spawnFn = spawn, pythonBin, timeoutMs = 22000 } = {}
) {
	return new Promise((resolve) => {
		const bin = pythonBin || process.env.LYRICS_PYTHON_BIN || 'python3';
		let child;
		try {
			child = spawnFn(
				bin,
				[CANONICAL_SCRIPT, artist, title, album || '', String(Math.round(Number(duration) || 0))],
				{ stdio: ['ignore', 'pipe', 'ignore'] }
			);
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
				const plain = String(parsed?.plain || parsed?.plainLyrics || '').trim();
				if (!plain) {
					finish(null);
					return;
				}
				finish({
					plain,
					source: parsed.source || 'lrclib-plain',
					artist: parsed.artist || artist,
					title: parsed.title || title
				});
			} catch {
				finish(null);
			}
		});
	});
}

/** @deprecated wrapper kept for existing tests - returns just the line array. */
export function fetchSyncedLyricsFallback(artist, title, opts = {}) {
	return fetchCommunityLyrics(artist, title, opts).then((hit) => hit?.lines || null);
}

export async function fetchLyrics(artist, title, { album = '', duration = 0, load, spawnFn, pythonBin } = {}) {
	const rounded = Math.round(Number(duration) || 0);
	const key = lyricsCacheKey(artist, title, album, rounded);
	const cached = readLyricsEntry(key);
	if (cached) return cached.lines;
	const getJson = load || defaultLoad;
	try {
		const [community, canonical] = await Promise.all([
			fetchCommunityLyrics(artist, title, { album, duration: rounded, spawnFn, pythonBin }),
			fetchCanonicalLyrics(artist, title, { album, duration: rounded, spawnFn, pythonBin })
		]);
		let lines = community?.lines || null;
		let plainText = canonical?.plain || community?.plain || null;
		let plainSource = canonical?.source || null;
		let source = community?.source || (lines ? 'community' : null);
		if (!lines) {
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
			lines = lyricsFromHit(hit, query);
			if (!plainText) plainText = hit?.plainLyrics || lyricsToPlainText(lines);
			if (!plainSource && hit?.plainLyrics) plainSource = 'lrclib-plain';
			if (lines) source = hit?.syncedLyrics ? 'lrclib-synced' : 'lrclib-plain';
		}
		if (lines) lines = dropNonLyricLines(lines, { artist, title });
		if (lines && !lines.length) lines = null;
		if (!plainText) plainText = lyricsToPlainText(lines);
		const wordLevel = Boolean(lines) && hasRealWordTiming(lines);
		writeLyricsEntry(key, {
			artist,
			title,
			album,
			duration: rounded,
			source: lines ? source : null,
			wordLevel,
			lines,
			plainText,
			plainSource,
			fetchedAt: Date.now(),
			ttl: !lines ? LYRICS_MISS_TTL : wordLevel ? LYRICS_WORD_LEVEL_TTL : LYRICS_HIT_TTL
		});
		return lines;
	} catch (error) {
		console.error('lyrics fetch error:', error.message);
		writeLyricsEntry(key, { lines: null, plainText: null, fetchedAt: Date.now(), ttl: LYRICS_MISS_TTL });
		return null;
	}
}

const lyricsInFlight = new Set();

/** Synchronous cache read: `{ known: true, lines }` once fetchLyrics() has
 *  resolved for this exact artist/title/album/duration, or
 *  `{ known: false, lines: null }` if it hasn't been looked up yet (or the
 *  cache entry expired). Lets getNowPlaying() serve whatever it already
 *  has instantly instead of awaiting a fresh LRCLIB/syncedlyrics round
 *  trip on every cold track. */
export function peekLyrics(artist, title, album = '', duration = 0) {
	const rounded = Math.round(Number(duration) || 0);
	const cached = readLyricsEntry(lyricsCacheKey(artist, title, album, rounded));
	if (!cached) return { known: false, lines: null };
	return { known: true, lines: cached.lines };
}

/** Like peekLyrics() but with the provenance the store keeps alongside the
 *  lines: `source` (community provider id / lrclib) and `wordLevel`. */
export function peekLyricsInfo(artist, title, album = '', duration = 0) {
	const rounded = Math.round(Number(duration) || 0);
	const cached = readLyricsEntry(lyricsCacheKey(artist, title, album, rounded));
	if (!cached) return { known: false, lines: null, plainText: null, source: null, wordLevel: false, plainSource: null };
	return {
		known: true,
		lines: cached.lines,
		plainText: cached.plainText || lyricsToPlainText(cached.lines),
		plainSource: cached.plainSource || null,
		source: cached.source || null,
		wordLevel: Boolean(cached.wordLevel) || hasRealWordTiming(cached.lines)
	};
}

/** Kicks off (at most once per track, de-duplicated across overlapping
 *  polls) a background fetchLyrics() call so a cache miss never blocks the
 *  current now-playing response - the result just shows up a poll or two
 *  later via peekLyrics(). */
export function ensureLyricsCached(artist, title, opts = {}) {
	const rounded = Math.round(Number(opts.duration) || 0);
	const key = lyricsCacheKey(artist, title, opts.album || '', rounded);
	if (lyricsInFlight.has(key) || peekLyrics(artist, title, opts.album, opts.duration).known) return;
	lyricsInFlight.add(key);
	fetchLyrics(artist, title, opts)
		.catch(() => {})
		.finally(() => lyricsInFlight.delete(key));
}

/** Plain (unsynced) lyric text for the on-device alignment fallback.
 *  Reuses fetchLyrics's cache rather than querying twice. */
export async function fetchPlainLyricsText(artist, title, opts = {}) {
	const rounded = Math.round(Number(opts.duration) || 0);
	const key = lyricsCacheKey(artist, title, opts.album || '', rounded);
	if (!readLyricsEntry(key)) {
		await fetchLyrics(artist, title, opts);
	}
	const next = readLyricsEntry(key);
	return next?.plainText || lyricsToPlainText(next?.lines) || null;
}

export function peekPlainLyrics(artist, title, album = '', duration = 0) {
	const rounded = Math.round(Number(duration) || 0);
	const cached = readLyricsEntry(lyricsCacheKey(artist, title, album, rounded));
	if (!cached) return null;
	return cached.plainText || lyricsToPlainText(cached.lines);
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
