/** Community karaoke sources (TTML / YRC / KRC) often stamp contractions
 *  as separate timed tokens: `don` + `'` + `t`. Joining those with spaces
 *  paints "don ' t" on screen. Glue them back into one sung word. */

const PUNCT_ONLY_RE = /^[\p{P}\p{S}]+$/u;
const GLUE_PREFIX_RE = /^['’ʼ‘‛`,.!?;:)\]…]+/;
const CONTRACTION_RE = /^(n['’]t|['’](?:t|s|re|ll|ve|d|m))$/i;
const ENDS_APOS_RE = /['’]$/;
const WORD_CHARS_RE = /^[A-Za-z]+$/;

export function shouldGlueLyricTokens(prevText, nextText) {
	const prev = String(prevText || '');
	const next = String(nextText || '');
	if (!prev || !next) return false;
	if (PUNCT_ONLY_RE.test(next)) return true;
	if (GLUE_PREFIX_RE.test(next) || CONTRACTION_RE.test(next)) return true;
	if (ENDS_APOS_RE.test(prev) && WORD_CHARS_RE.test(next) && next.length <= 3) return true;
	return false;
}

function cleanWord(word) {
	if (!word || typeof word !== 'object') return word;
	const { breakBefore: _b, breakAfter: _a, ...rest } = word;
	return rest;
}

/** Merge punctuation / contraction fragments. Whitespace-only tokens and
 *  `breakBefore` mark a real word boundary (TTML inter-span space). */
export function coalesceLyricWords(words) {
	if (!Array.isArray(words) || !words.length) return [];
	const out = [];
	for (const raw of words) {
		const original = String(raw?.text ?? '');
		if (/^\s+$/.test(original)) {
			if (out.length) out[out.length - 1].breakAfter = true;
			continue;
		}
		const breakBefore = Boolean(raw?.breakBefore) || /^\s/.test(original);
		const breakAfter = Boolean(raw?.breakAfter) || /\s$/.test(original);
		const text = original.replace(/\s+/g, ' ').trim();
		if (!text) {
			if (breakAfter && out.length) out[out.length - 1].breakAfter = true;
			continue;
		}
		const time = Number(raw.time) || 0;
		const end = Number(raw.end);
		const next = {
			time,
			text,
			...(Number.isFinite(end) && end > time ? { end } : {}),
			...(raw.estimated ? { estimated: true } : {}),
			breakAfter
		};
		const prev = out[out.length - 1];
		// Contractions and punctuation glue even when the source put
		// spaces around them (`don` `'` `t` must not paint as "don ' t").
		const glue = prev && shouldGlueLyricTokens(prev.text, next.text);
		if (glue) {
			const mergedEnd = Number.isFinite(end) && end > (Number(prev.end) || prev.time) ? end : prev.end;
			prev.text += next.text;
			if (Number.isFinite(mergedEnd)) prev.end = mergedEnd;
			prev.breakAfter = Boolean(prev.breakAfter || next.breakAfter);
		} else {
			out.push(next);
		}
	}
	return out.map(cleanWord);
}

function lyricLetters(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '');
}

export function lineWithCoalescedWords(line) {
	if (!line?.words?.length) return line;
	const words = coalesceLyricWords(line.words);
	if (!words.length) {
		const { words: _w, ...rest } = line;
		return rest;
	}
	const fromWords = words.map((w) => w.text).join(' ');
	const original = String(line.text || '').trim();
	// Qwen used to store a truncated word list while keeping the full line
	// text. Keep that fuller text. YRC/TTML pass the unglued join ("don ' t")
	// as `text`; prefer the coalesced words in that case.
	const keepOriginal = original && lyricLetters(original).length > lyricLetters(fromWords).length;
	return { ...line, words, text: keepOriginal ? original : fromWords || original };
}

const DISPLAY_TOKEN_RE = /[A-Za-z0-9']+/g;

function sameToken(a, b) {
	return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function preferLineToken(timedText, tok) {
	if (!tok) return timedText;
	if (timedText === tok || sameToken(timedText, tok)) return tok;
	const a = String(timedText || '').toLowerCase();
	const b = String(tok || '').toLowerCase();
	if (b.startsWith(a) || a.startsWith(b)) return tok;
	return timedText;
}

/** Karaoke paints `line.words`, not `line.text`. Qwen's older remap could
 *  store three timed tokens for "I walk a lonely road" and the stack would
 *  show "i walk a". Fill missing tokens from the original line and restore
 *  that line's spelling when the aligner only lowercased it. */
export function displayLyricWords(line) {
	const text = String(line?.text || '').trim();
	const words = Array.isArray(line?.words)
		? line.words.filter((word) => word && String(word.text || '').trim())
		: [];
	if (!text) return words;
	const tokens = text.match(DISPLAY_TOKEN_RE);
	if (!tokens?.length) return words;
	if (words.length >= tokens.length) {
		return words.map((timed, i) => {
			const tok = tokens[i];
			if (!tok || timed.text === tok || !sameToken(timed.text, tok)) return timed;
			return { ...timed, text: tok };
		});
	}
	const out = [];
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		const timed = words[i];
		if (timed) {
			const next = preferLineToken(timed.text, tok);
			out.push(next === timed.text ? timed : { ...timed, text: next });
			continue;
		}
		const prev = out[out.length - 1] || {};
		const t = Number(prev.end) || Number(prev.time) || Number(line.time) || 0;
		out.push({ time: t, text: tok, end: t });
	}
	return out;
}

/** When a precise aligner stored a clipped line ("i walk a") and the
 *  community file still has the rest of the sentence, copy that fuller
 *  text onto the aligned clocks so the kiosk can paint the missing words. */
export function overlayCommunityText(alignedLines, communityLines) {
	if (!Array.isArray(alignedLines) || !alignedLines.length) return alignedLines;
	if (!Array.isArray(communityLines) || !communityLines.length) return alignedLines;
	const unused = communityLines.slice();
	let changed = false;
	const out = alignedLines.map((line) => {
		const alignedText = String(line?.text || '').trim();
		const a = lyricLetters(alignedText);
		if (!a) return line;
		let best = null;
		let bestIdx = -1;
		for (let i = 0; i < unused.length; i++) {
			const communityText = String(unused[i]?.text || '').trim();
			const c = lyricLetters(communityText);
			if (!c) continue;
			if (c === a) {
				best = unused[i];
				bestIdx = i;
				break;
			}
			if (c.startsWith(a) && c.length > a.length) {
				best = unused[i];
				bestIdx = i;
				break;
			}
		}
		if (bestIdx >= 0) unused.splice(bestIdx, 1);
		const fuller = String(best?.text || '').trim();
		if (fuller && lyricLetters(fuller).length > a.length) {
			changed = true;
			return { ...line, text: fuller };
		}
		return line;
	});
	return changed ? out : alignedLines;
}
