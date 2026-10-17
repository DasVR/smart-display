/**
 * The phone's voice agent: talking to the wall the way "Hey Display" does,
 * from the remote.
 *
 * Hold the mic key and a sheet rises with the listening orb; say it; let go
 * and it goes to the wall exactly like a sentence said to its microphone
 * (src/lib/server/taskHub.js sayAdd), and the answer comes back on the
 * sheet. A quick tap latches it open instead, for typing or tap-to-talk.
 *
 * Pure bits live here so they can be tested without a phone:
 *  - the press gesture (hold, tap, slide to cancel)
 *  - the phase machine (idle, listening, thinking, speaking, error)
 *  - smoothing the mic level the orb follows
 *  - what to say when the microphone can't be used
 *
 * The browser parts: src/lib/services/listen.js, src/lib/shaders/voiceOrb.js,
 * src/lib/components/VoiceAgent.svelte.
 */

import { asksBack } from './assistant.js';

/** A press this long is a hold: the sheet rises and listening starts. */
export const HOLD_MS = 190;
/** Slide this far left (px) before letting go to throw the sentence away. */
export const CANCEL_PX = 84;
/** How long a reply stays up after it's done, before the sheet may close itself (ms). */
export const LINGER_MS = 9000;

export const PHASES = ['idle', 'listening', 'thinking', 'speaking', 'error'];

/** Fresh gesture state for a press that just landed at (x, y). */
export function pressStart(x, y, at) {
	return { x, y, at, mode: 'pending', dx: 0 };
}

/** The finger moved. Sliding left past CANCEL_PX arms a cancel; coming back disarms it. */
export function pressMove(g, x) {
	if (!g || g.mode === 'tap' || g.mode === 'done') return g;
	const dx = x - g.x;
	const cancel = dx <= -CANCEL_PX;
	return { ...g, dx, cancel };
}

/** Time passed with the finger down: a pending press becomes a hold. */
export function pressTick(g, at) {
	if (!g || g.mode !== 'pending') return g;
	return at - g.at >= HOLD_MS ? { ...g, mode: 'hold' } : g;
}

/**
 * The finger lifted. Returns what to do:
 *   tap     - released before HOLD_MS: latch the sheet open
 *   send    - a hold that ended in place: send what was heard
 *   cancel  - a hold that ended slid left: throw it away
 */
export function pressEnd(g, at) {
	if (!g) return { ...g, action: 'cancel' };
	const held = g.mode === 'hold' || at - g.at >= HOLD_MS;
	if (!held) return { ...g, mode: 'tap', action: 'tap' };
	return { ...g, mode: 'done', action: g.cancel ? 'cancel' : 'send' };
}

/**
 * Where the phase goes next. Events: press (listening starts), heard (a
 * final sentence), sent (it left for the wall), answer, spoken (the phone
 * finished reading it), fail, cancel, reset.
 */
export function nextPhase(phase, event) {
	switch (event) {
		case 'press':
			return phase === 'thinking' ? phase : 'listening';
		case 'sent':
			return 'thinking';
		case 'answer':
			return 'speaking';
		case 'spoken':
			return phase === 'speaking' ? 'idle' : phase;
		case 'fail':
			return 'error';
		case 'cancel':
		case 'reset':
			return 'idle';
		default:
			return phase;
	}
}

/**
 * The orb follows the mic level with a quick attack and a slow release, so
 * a syllable pops and a pause settles, rather than flickering. `dt` in seconds.
 */
export function followLevel(prev, target, dt) {
	const t = Math.max(0, Math.min(1, target));
	const rate = t > prev ? 22 : 5.5;
	const k = 1 - Math.exp(-rate * Math.max(0, dt));
	return prev + (t - prev) * k;
}

/** Root-mean-square of an analyser's time-domain bytes, 0 to 1 (silence is 128). */
export function rmsOf(bytes) {
	if (!bytes?.length) return 0;
	let sum = 0;
	for (let i = 0; i < bytes.length; i++) {
		const v = (bytes[i] - 128) / 128;
		sum += v * v;
	}
	return Math.sqrt(sum / bytes.length);
}

/** Speech sits low in the RMS range; stretch it so quiet talk still moves the orb. */
export function levelFromRms(rms) {
	return Math.max(0, Math.min(1, Math.pow(rms * 5.2, 0.8)));
}

/** A blip of energy for each new word the recogniser hands over, for phones that won't share the mic. */
export function wordPulse(prevText, nextText) {
	const count = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
	const grew = count(nextText) - count(prevText);
	return grew > 0 ? Math.min(1, 0.45 + grew * 0.2) : 0;
}

/**
 * One sentence out of the recogniser's result list. Some phones (Android
 * Chrome in continuous mode) make every result hold everything heard so far,
 * so gluing the results together says it twice: "what's the weather what's
 * the weather", which the wall can't read as a question. A result that starts
 * with the text so far replaces it; one that's already the end of it is
 * dropped; anything else is a new phrase and is added.
 */
export function mergeResults(parts) {
	let out = '';
	for (const raw of parts || []) {
		const cur = String(raw || '').replace(/\s+/g, ' ').trim();
		if (!cur) continue;
		if (!out) out = cur;
		else if (cur.toLowerCase().startsWith(out.toLowerCase())) out = cur;
		else if (out.toLowerCase().endsWith(cur.toLowerCase())) continue;
		else out += ` ${cur}`;
	}
	return out;
}

/** Two stretches of speech as one: what was heard before the recogniser restarted, then after. */
export function joinSpeech(before, after) {
	return mergeResults([before, after]);
}

/** The sentence as it should be sent: trimmed, one space between words, first letter up. */
export function cleanHeard(text) {
	const s = String(text || '').replace(/\s+/g, ' ').trim();
	return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** Whether the wall's answer asks something back, so listening should start again by itself. */
export function wantsAnswer(say) {
	return asksBack(say);
}

/**
 * Why voice can't run here, in a sentence a person can use. '' when it can.
 * `env` is the browser (injected so the tests can fake one).
 */
export function voiceBlocker(env = {}) {
	const { secure = true, recognition = true, standalone = false } = env;
	if (!secure) return 'Voice needs a secure address. Open the remote over https (Tailscale serve gives you one). Typing works meanwhile.';
	if (!recognition) return standalone ? 'This phone can’t listen from the home screen app. Typing works.' : 'This browser can’t listen. Typing works.';
	return '';
}

/** The short line under the orb for each phase. */
export function phaseLine(phase, { cancel = false, latched = false, hasText = false } = {}) {
	if (phase === 'listening') {
		if (cancel) return 'Release to cancel';
		if (latched) return hasText ? 'Listening…' : 'Go ahead, I’m listening';
		return hasText ? 'Release to send' : 'Listening. Slide left to cancel';
	}
	if (phase === 'thinking') return 'Thinking…';
	if (phase === 'speaking') return 'Display';
	if (phase === 'error') return 'Didn’t get through';
	return latched ? 'Tap the mic or type' : '';
}

/** A few things worth saying first, shown when the sheet opens with nothing heard. */
export const SUGGESTIONS = ['What’s on the wall?', 'Set a timer for ten minutes', 'Play some jazz', 'What’s the weather?'];
