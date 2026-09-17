/** Shared lyric-line cleanup used by the server fetch path and the
 *  Music view, so a cached hit still loses title headers and dash-only
 *  instrumental cues without waiting for a refetch. */

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
	/^(作词|作詞|作曲|编曲|編曲|制作人|製作人|歌词|歌詞|演唱|歌手|出品)(\s*[:：]|\s+)|^(produced\s*by|written\s*by|lyrics\s*by|lyricist|composer|arranger|lyrics|composer)\s*[:：]/i;

const VERSION_JUNK_RE =
	/^(remix|mix|edit|version|ver|radio|live|acoustic|official|video|audio|lyrics|lyric|mv|pv|ost|theme|from|cover|inst|instrumental|deluxe|remaster(?:ed)?|extended|short|long|intro|outro|interlude|bonus)$/i;

const INSTRUMENTAL_NAME_RE =
	/^(instrumental|interlude|intro|outro|bridge|break|inst|music|間奏|间奏|前奏|尾奏|伴奏)$/i;

/** Glyphs community files use for a rest: em dashes, tildes, music notes,
 *  ellipses, bullets. A line made of only these is a break, not a lyric. */
const BREAK_GLYPH_RE = /[\s\-–—−‐‑‒―~～˜.·•‧、。*＊★☆♪♫♩♬♮♯♭…⋯‥]+/g;

function stripDecorations(text) {
	return String(text || '')
		.replace(/[\(\[\{【「『].*?[\)\]\}】」』]/g, ' ')
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
		.trim();
}

function coreTitle(text) {
	return normalizeLyricText(stripDecorations(text));
}

export function isInstrumentalCue(text) {
	const raw = String(text || '').trim();
	if (!raw) return true;
	const glyphsGone = raw.replace(BREAK_GLYPH_RE, '');
	if (!glyphsGone) return true;
	const n = normalizeLyricText(raw);
	if (!n) return true;
	return INSTRUMENTAL_NAME_RE.test(n.replace(/\s+/g, ''));
}

export function isTrackHeaderLine(text, query = {}, { index, firstContentIndex } = {}) {
	const n = normalizeLyricText(text);
	const core = coreTitle(text);
	const title = normalizeLyricText(query.title);
	const titleCore = coreTitle(query.title);
	const artist = normalizeLyricText(query.artist);
	if (!n || !title) return false;

	const matchesTitle = n === title || core === title || n === titleCore || core === titleCore;
	if (matchesTitle) {
		// Exact / parenthetical-stripped title: only the opening header.
		// A later chorus that repeats the title is a real lyric.
		if (firstContentIndex == null) return true;
		return index === firstContentIndex;
	}

	if (artist) {
		if (n === `${title} ${artist}` || n === `${artist} ${title}`) return true;
		if (core === `${title} ${artist}` || core === `${artist} ${title}`) return true;
		if (n.startsWith(title) && n.endsWith(artist) && n.length > title.length + artist.length) {
			return true;
		}
		if (core.startsWith(titleCore) && core.endsWith(artist) && core.length > titleCore.length + artist.length) {
			return true;
		}
	}

	if (n.startsWith(`${title} `) || (titleCore && core.startsWith(`${titleCore} `))) {
		const rest = n.slice(title.length).trim().split(/\s+/).filter(Boolean);
		if (rest.length && rest.every((tok) => VERSION_JUNK_RE.test(tok) || (artist && tok === artist))) {
			return true;
		}
	}
	return false;
}

/** Drops credit/title header rows and turns dash-only / "instrumental"
 *  cues into blank timed markers (the Music view's three-dot rest). */
export function cleanLyricLines(lines, query = {}) {
	const list = Array.isArray(lines) ? lines : [];
	const prepared = list.map((line) => {
		if (!line) return line;
		const text = String(line.text || '').trim();
		if (text && isInstrumentalCue(text)) {
			const next = { ...line, text: '', instrumental: true };
			delete next.words;
			return next;
		}
		return line;
	});

	const withoutCredits = prepared.filter((line) => {
		const text = String(line?.text || '').trim();
		if (!text) return true;
		return !CREDIT_LINE_RE.test(text);
	});

	let firstContentIndex = -1;
	for (let i = 0; i < withoutCredits.length; i++) {
		if (String(withoutCredits[i]?.text || '').trim()) {
			firstContentIndex = i;
			break;
		}
	}

	return withoutCredits.filter((line, index) => {
		const text = String(line?.text || '').trim();
		if (!text) return true;
		return !isTrackHeaderLine(text, query, { index, firstContentIndex });
	});
}

/** @deprecated name kept for existing tests / call sites. */
export const dropNonLyricLines = cleanLyricLines;
