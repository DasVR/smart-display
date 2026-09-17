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

export function lineWithCoalescedWords(line) {
	if (!line?.words?.length) return line;
	const words = coalesceLyricWords(line.words);
	if (!words.length) {
		const { words: _w, ...rest } = line;
		return rest;
	}
	return { ...line, words, text: words.map((w) => w.text).join(' ') };
}
