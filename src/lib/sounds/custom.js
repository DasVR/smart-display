// Sounds made from the phone: pure helpers shared by the kiosk's sound hub
// (src/lib/server/soundHub.js), the phone page and the tests.
//
// A custom sound is a short idea ("a doorbell", "pouring tea") turned into a
// full ElevenLabs sound-effect prompt in the same family as the built-in
// library (src/lib/sounds/library.js): pencils, notebooks, creamy keyboard
// switches and soft pocket-gadget buttons on a quiet desk.
// The mp3 lives on the kiosk in data/sounds/, so it survives restarts and
// plays without ever calling ElevenLabs again.

import { DESK, NO_BELLS, SOUND_LIBRARY, soundEntry } from './library.js';

/** The feel of every built-in sound; added to an idea unless it says otherwise. */
export const ROOM = DESK;

export const MAX_CUSTOM = 24;
export const MIN_SECONDS = 0.5;
export const MAX_SECONDS = 6;
export const DEFAULT_GAIN = 0.6;
/** Seconds of generated sound per day. About what the whole library costs, twice. */
export const DAILY_SECONDS = 90;

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Prompts to try, shown as chips on the phone page. */
export const SOUND_IDEAS = [
	'a pencil being sharpened',
	'a typewriter carriage return',
	'creamy keyboard typing',
	'a notebook snapping shut',
	'a pen cap clicking on',
	'a pocket gadget button with a haptic tick',
	'sticky note peeled off a pad',
	'two pencil taps on a notebook'
];

/** Library kinds a custom sound can stand in for (each one is a playChime() kind). */
export const ASSIGNABLE = SOUND_LIBRARY.map((s) => ({ name: s.name, group: s.group }));

/**
 * What was typed, cleaned up: "make me a sound of a doorbell" -> "a doorbell".
 * Empty when there's nothing to go on.
 */
export function cleanIdea(text) {
	let s = String(text ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	s = s.replace(/^(?:please\s+)?(?:(?:can|could) you\s+)?(?:make|create|generate|give|record)(?: me)?\s+(?:a |an |some )?(?:new )?(?:sound effect|sound|noise|sfx)(?: of| for| like| that sounds like)?\s+/i, '');
	s = s.replace(/^(?:a |an |some )?(?:sound effect|sound|noise|sfx)(?: of| for| like)\s+/i, '');
	s = s.replace(/[.!?]+$/, '').trim();
	if (s.length > 140) s = s.slice(0, 140).replace(/\s+\S*$/, '');
	return s.length >= 2 ? s : '';
}

/**
 * The full prompt. In the wall's house style (a quiet desk, no bells unless
 * the idea asks for one) unless it's typed with a leading "!", which sends it
 * as written.
 */
export function buildSoundPrompt(idea) {
	const raw = String(idea ?? '').trim();
	const literal = raw.startsWith('!');
	const clean = cleanIdea(literal ? raw.slice(1) : raw);
	if (!clean) return { idea: '', prompt: '', literal };
	if (literal || /\bquiet\b.*\b(?:room|desk)\b|\bno music\b/i.test(clean)) return { idea: clean, prompt: clean, literal };
	// the wall has no bells, unless you ask for one
	const asksForBell = /\b(?:bells?|chimes?|dings?|ring(?:s|ing)?|doorbell)\b/i.test(clean);
	const prompt = asksForBell ? `${clean}, ${ROOM}` : `${clean}, ${ROOM}, ${NO_BELLS}`;
	return { idea: clean, prompt, literal };
}

/** How long the clip should be, guessed from the idea: a tap is short, a ring or a swell is longer. */
export function guessSeconds(idea) {
	const s = String(idea ?? '').toLowerCase();
	if (/\b(?:long|ring(?:ing)?|alarm|bell|chime|swell|rain|pour|wind|creak|jingl|music box|fade|ocean|wave)\b/.test(s)) return 2.5;
	if (/\b(?:tap|click|knock|tick|pop|snap|drop|ping|ting|thud|clack|thock|keypress)\b/.test(s)) return 0.8;
	return 1.5;
}

export function clampSeconds(n, fallback = 1.5) {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.round(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, v)) * 10) / 10;
}

/** "Pouring tea into a cup!" -> "pouring-tea-into-a-cup", unique among `taken`. */
export function soundName(idea, taken = []) {
	const words = String(idea ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter((w) => w && !['a', 'an', 'the', 'of', 'some'].includes(w));
	let base = words.join('-').replace(/-+/g, '-').slice(0, 24).replace(/-$/, '') || 'sound';
	if (!/^[a-z0-9]/.test(base)) base = `s-${base}`;
	const used = new Set(taken);
	let name = base;
	for (let i = 2; used.has(name); i++) name = `${base.slice(0, 28)}-${i}`;
	return name;
}

/** The library entry for a kind, shaped like a request to the sound-generation API. */
export function libraryRequest(kind) {
	const e = soundEntry(kind);
	return e ? { kind: e.name, name: e.name, idea: e.prompt.replace(/, close-miked.*$/, ''), prompt: e.prompt, seconds: e.seconds, influence: e.influence, gain: e.gain } : null;
}
