/** Lyric providers (Musixmatch, NetEase, some LRCLIB uploads) mask profanity
 *  as `f**k`, `sh*t`, `n***a` or `****`. The display shows the words the
 *  artist actually sang, so masked tokens are restored: first from the
 *  canonical lyric sheet (Genius / LRCLIB plain), then from a dictionary
 *  keyed by the visible letters and the mask length. A masked token only
 *  changes when a candidate fits it exactly; anything ambiguous stays. */

// Ordered by how often each form shows up in lyrics, so `s**t` is "shit".
const DICTIONARY = [
	'fuck', 'fucking', 'fuckin', "fuckin'", 'fucked', 'fucks', 'fucker', 'fuckers',
	'motherfucker', 'motherfuckers', 'motherfucking', 'motherfuckin', "motherfuckin'",
	'fuckboy', 'fuckboys', 'fuckery',
	'shit', 'shits', 'shitty', 'shitting', 'shittin', "shittin'", 'bullshit', 'horseshit', 'shithead',
	'bitch', 'bitches', 'bitchin', "bitchin'", 'bitching', 'bitchy',
	'nigga', 'niggas', 'niggaz', 'nigger', 'niggers',
	'ass', 'asses', 'asshole', 'assholes', 'jackass', 'badass', 'dumbass',
	'damn', 'damned', 'goddamn', 'goddamned', 'dammit', 'goddammit',
	'dick', 'dicks', 'dickhead', 'pussy', 'pussies', 'cock', 'cocks', 'cunt', 'cunts',
	'hell', 'hoe', 'hoes', 'whore', 'whores', 'slut', 'sluts', 'bastard', 'bastards',
	'piss', 'pissed', 'pissing', 'crap', 'tits', 'titties', 'prick', 'twat', 'wanker'
];

const MASK_CHARS = '*#';
const TOKEN_RE = /[\p{L}\p{N}'’*#]+(?:(?:-{2,}|[—–])[\p{L}\p{N}'’*#]*)*/gu;

/** True when a token hides letters behind `*`, `#`, `--` or a dash. */
export function isMaskedToken(token) {
	const raw = String(token || '');
	if (/[*#]/.test(raw)) return true;
	return /\p{L}(?:-{2,}|[—–])/u.test(raw);
}

function escapeRe(ch) {
	return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching every word the mask could stand for. `*`/`#`/`-` are one
 *  hidden letter each; an em or en dash hides one or more. */
function maskPattern(token) {
	let src = '';
	const raw = String(token || '').replace(/’/g, "'");
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (MASK_CHARS.includes(ch)) src += "[\\p{L}']";
		else if (ch === '—' || ch === '–') src += "[\\p{L}']+";
		else if (ch === '-' && (raw[i + 1] === '-' || raw[i - 1] === '-')) src += "[\\p{L}']";
		else src += escapeRe(ch.toLowerCase());
	}
	return new RegExp(`^${src}$`, 'u');
}

function matchCase(original, word) {
	const letters = String(original).replace(/[^\p{L}]/gu, '');
	if (letters.length > 1 && letters === letters.toUpperCase()) return word.toUpperCase();
	if (letters && letters[0] === letters[0].toUpperCase() && letters[0] !== letters[0].toLowerCase()) {
		return word[0].toUpperCase() + word.slice(1);
	}
	return word;
}

function splitEdges(token) {
	const m = String(token).match(/^([^\p{L}\p{N}*#—–-]*)(.*?)([^\p{L}\p{N}*#—–'’-]*)$/u);
	return m ? { lead: m[1], core: m[2], tail: m[3] } : { lead: '', core: String(token), tail: '' };
}

function fullyMasked(core) {
	return !/[\p{L}\p{N}]/u.test(core);
}

/** Restores one masked token. `vocabulary` (lowercased words from the
 *  canonical sheet) is tried before the dictionary so the song's own
 *  spelling wins ("niggaz" vs "niggas"). Returns the token unchanged when
 *  nothing fits or when the whole token is a mask (`****`). */
export function uncensorToken(token, vocabulary = []) {
	const raw = String(token || '');
	if (!isMaskedToken(raw)) return raw;
	const { lead, core, tail } = splitEdges(raw);
	if (!core || fullyMasked(core)) return raw;
	const re = maskPattern(core);
	const fits = (word) => re.test(word);
	const hit =
		vocabulary.find(fits) ||
		DICTIONARY.find(fits) ||
		closestLoose(core, vocabulary) ||
		closestLoose(core, DICTIONARY);
	if (hit) return `${lead}${matchCase(core, hit)}${tail}`;
	// `f**k'bout`: a provider dropped the space; fix the masked piece alone.
	const pieces = core.split(/(['’](?=\p{L}))/u);
	if (pieces.length > 1) {
		const fixed = pieces.map((part) => (isMaskedToken(part) ? uncensorToken(part, vocabulary) : part)).join('');
		if (fixed !== core) return `${lead}${fixed}${tail}`;
	}
	return raw;
}

/** Some providers star a swear with the wrong count (NetEase writes
 *  "motherfuckin'" as `*********in`). With each star run free-length, the
 *  candidate closest in length to the mask wins. Needs a visible letter. */
function closestLoose(core, words) {
	if (!/\p{L}/u.test(core)) return null;
	const src = String(core)
		.replace(/’/g, "'")
		.split(/([*#]+|-{2,}|[—–])/)
		.map((part, i) => (i % 2 ? "[\\p{L}']+" : escapeRe(part.toLowerCase())))
		.join('');
	const re = new RegExp(`^${src}'?$`, 'u');
	let best = null;
	for (const word of words) {
		if (!re.test(word)) continue;
		if (!best || Math.abs(word.length - core.length) < Math.abs(best.length - core.length)) best = word;
	}
	return best;
}

function tokens(text) {
	return String(text || '').match(TOKEN_RE) || [];
}

function plainToken(token) {
	return splitEdges(token).core.toLowerCase().replace(/’/g, "'");
}

/** Canonical sheet → `{ lines: [[token]], vocabulary: [word] }`. */
export function buildUncensorContext(canonicalText) {
	const lines = String(canonicalText || '')
		.split(/\r?\n/)
		.map((line) => tokens(line))
		.filter((toks) => toks.length);
	const vocabulary = [];
	const seen = new Set();
	for (const toks of lines) {
		for (const tok of toks) {
			if (isMaskedToken(tok)) continue;
			const word = plainToken(tok);
			if (word && !seen.has(word)) {
				seen.add(word);
				vocabulary.push(word);
			}
		}
	}
	return { lines, vocabulary };
}

/** Uncensored words from the first sheet line with the same shape as
 *  `lineTokens`: equal token count, every clear token equal, every masked
 *  token a fit. Recovers fully masked `****` tokens. */
function sheetLineFor(lineTokens, ctx) {
	for (const sheet of ctx?.lines || []) {
		if (sheet.length !== lineTokens.length) continue;
		let ok = true;
		for (let i = 0; i < sheet.length && ok; i++) {
			const want = lineTokens[i];
			const got = plainToken(sheet[i]);
			if (isMaskedToken(sheet[i])) ok = false;
			else if (isMaskedToken(want)) {
				const core = splitEdges(want).core;
				ok = fullyMasked(core) ? Boolean(got) : maskPattern(core).test(got);
			} else ok = plainToken(want) === got;
		}
		if (ok) return sheet;
	}
	return null;
}

function replaceTokens(text, replacer) {
	let index = 0;
	return String(text).replace(TOKEN_RE, (tok) => replacer(tok, index++));
}

function restoreWith(tok, sheetTok, ctx) {
	if (!isMaskedToken(tok)) return tok;
	if (sheetTok) {
		const { lead, core, tail } = splitEdges(tok);
		return `${lead}${matchCase(core, plainToken(sheetTok))}${tail}`;
	}
	return uncensorToken(tok, ctx?.vocabulary);
}

/** Uncensors a lyric string. */
export function uncensorText(text, ctx = null) {
	const raw = String(text ?? '');
	const toks = tokens(raw);
	if (!toks.some(isMaskedToken)) return raw;
	const sheet = sheetLineFor(toks, ctx);
	return replaceTokens(raw, (tok, i) => restoreWith(tok, sheet?.[i], ctx));
}

function uncensorPart(part, ctx) {
	if (!part || typeof part !== 'object') return part;
	const text = String(part.text || '');
	const words = Array.isArray(part.words) ? part.words : null;
	const lineMasked = isMaskedTokenIn(text);
	const wordsMasked = words?.some((w) => isMaskedTokenIn(w?.text));
	if (!lineMasked && !wordsMasked) return part;
	const fixedText = uncensorText(text, ctx);
	const next = { ...part, text: fixedText };
	if (words) {
		const fixedToks = tokens(fixedText);
		const aligned = fixedToks.length === words.length;
		next.words = words.map((word, i) => {
			if (!isMaskedTokenIn(word?.text)) return word;
			const sheetTok = aligned && !isMaskedToken(fixedToks[i]) ? fixedToks[i] : null;
			const restored = replaceTokens(word.text, (tok) => restoreWith(tok, sheetTok, ctx));
			return restored === word.text ? word : { ...word, text: restored };
		});
	}
	if (Array.isArray(part.background)) next.background = part.background.map((bg) => uncensorPart(bg, ctx));
	return next;
}

function isMaskedTokenIn(text) {
	return tokens(text).some(isMaskedToken);
}

/** Uncensors every line (lead text, timed words, background rows). Returns
 *  the same array when nothing was masked. */
export function uncensorLines(lines, canonicalText = '') {
	if (!Array.isArray(lines) || !lines.length) return lines;
	const needs = lines.some(
		(line) =>
			isMaskedTokenIn(line?.text) ||
			line?.words?.some((w) => isMaskedTokenIn(w?.text)) ||
			line?.background?.some((bg) => isMaskedTokenIn(bg?.text))
	);
	if (!needs) return lines;
	const ctx = buildUncensorContext(canonicalText);
	return lines.map((line) => uncensorPart(line, ctx));
}

/** Uncensors a whole plain-text sheet line by line (the aligner's input). */
export function uncensorPlain(text, reference = '') {
	const raw = String(text ?? '');
	if (!isMaskedTokenIn(raw)) return raw;
	const ctx = buildUncensorContext(reference || '');
	return raw
		.split(/\n/)
		.map((line) => uncensorText(line, ctx))
		.join('\n');
}
