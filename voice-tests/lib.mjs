/**
 * The voice lab's shared door into the wall. Everything stays on this
 * machine: the wall's own server (VOICE_TEST_BASE, default
 * http://127.0.0.1:3000) and its real Phonon and Parakeet.
 */
import { readFileSync } from 'node:fs';

export const BASE = (process.env.VOICE_TEST_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

export function readLines(path) {
	return readFileSync(path, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'));
}

/** Speak `text` through the wall -> { wav, durationMs }. Throws on failure. */
export async function say(text, { voice, durationDelta } = {}) {
	const body = { input: text };
	if (voice) body.voice = voice;
	if (durationDelta != null) body.duration_delta = durationDelta;
	const res = await fetch(`${BASE}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	if (!res.ok) throw new Error(`speech failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
	return { wav: Buffer.from(await res.arrayBuffer()), durationMs: Number(res.headers.get('x-duration-ms')) || 0 };
}

/** Parakeet hears a WAV back (multipart file=@, model=parakeet) -> text. */
export async function transcribe(wav) {
	const form = new FormData();
	form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
	form.append('model', 'parakeet');
	const res = await fetch(`${BASE}/v1/audio/transcriptions`, { method: 'POST', body: form });
	const out = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`transcribe failed: HTTP ${res.status} ${JSON.stringify(out).slice(0, 160)}`);
	return String(out.text || '').trim();
}

/** What's on the wall (model, voices, up) for results headers; ''s when down. */
export async function boxStatus() {
	try {
		const res = await fetch(`${BASE}/api/voice/box`);
		return res.ok ? await res.json() : { up: false };
	} catch {
		return { up: false };
	}
}

export const words = (text) => text.split(/\s+/).filter(Boolean);

// How the ear writes what was said on purpose: "one" == "1", spelled letters
// merge ("A P I" heard back as "API"), symbols said as words ("dot", "slash",
// "dash", "colon", "point") count as the symbol, not as an extra word.
const NUMBER_WORDS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const SPOKEN_SYMBOLS = new Set(['dot', 'slash', 'dash', 'colon', 'point']);
const ITN_ALIASES = { jason: 'json' };

/** Words as WER sees them: lowercase, apostrophes absorbed, punctuation
 *  folded to the spoken-symbol words above. */
export function normalize(text) {
	const toks = words(
		String(text)
			.toLowerCase()
			.replace(/[''']/g, '')
			.replace(/[^\w\s]/g, ' ')
			.replace(/\s+/g, ' ')
	)
		.map((t) => NUMBER_WORDS[t] || ITN_ALIASES[t] || t)
		.filter((t) => !SPOKEN_SYMBOLS.has(t));
	// spelled letters merge back: "a p i" -> "api" (Parakeet writes acronyms compact)
	const out = [];
	let spelling = '';
	for (const t of toks) {
		if (/^[a-z]$/.test(t)) spelling += t;
		else {
			if (spelling) {
				out.push(spelling);
				spelling = '';
			}
			out.push(t);
		}
	}
	if (spelling) out.push(spelling);
	return out;
}

/** Word error rate via Levenshtein on the normalized word sequences. */
export function wer(reference, heard) {
	const ref = normalize(reference);
	const hyp = normalize(heard);
	if (!ref.length) return { wer: 0, errors: hyp.length, words: 0 };
	const row = Array.from({ length: hyp.length + 1 }, (_, j) => j);
	for (let i = 0; i < ref.length; i++) {
		let prev = row[0];
		row[0] = i + 1;
		for (let j = 0; j < hyp.length; j++) {
			const up = row[j + 1];
			row[j + 1] = Math.min(row[j] + 1, up + 1, prev + (ref[i] === hyp[j] ? 0 : 1));
			prev = up;
		}
	}
	const errors = row[hyp.length];
	return { wer: errors / ref.length, errors, words: ref.length };
}

/** data/voice-lexicon.json as JS rules (python `re` syntax; \1 becomes $1).
 *  Replacement functions keep $-signs in replacements literal. */
export function applyLexicon(text, lexicon) {
	for (const [word, said] of Object.entries(lexicon.acronyms || {})) {
		if (!word) continue;
		const rx = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
		text = text.replaceAll(rx, () => said);
	}
	for (const { pattern, replace } of lexicon.rewrites || []) {
		const said = String(replace).replace(/\\(\d)/g, '$$$1');
		text = text.replaceAll(new RegExp(pattern, 'g'), (...parts) => expand(said, parts));
	}
	return text.replace(/\s+/g, ' ').trim();
}

function expand(template, parts) {
	// parts: [match, ...groups, offset, string] — python groups sit at 1..N
	return template.replace(/\$(\d)/g, (_, n) => parts[Number(n)] ?? '');
}
