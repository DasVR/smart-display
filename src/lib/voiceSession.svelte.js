/**
 * One voice conversation on the phone, shared by the mic key in the tab bar
 * and the sheet that rises (both just read `voice` and call the functions
 * below). It listens (src/lib/services/listen.js), sends the sentence to the
 * wall the way the Try-a-phrase box does ({ type: 'tasks', op: 'say' }, so it
 * goes through the same order as the wall's own microphone: answers to what
 * it just asked, commands, things to add, then conversation), and shows or
 * speaks what comes back.
 *
 * The phone keeps its own small socket to the wall for this, opened the
 * first time the key is pressed, so voice works from any page of the remote.
 *
 * When the wall has its voice box (src/lib/server/voiceBox.js), it does the
 * listening and the reading too: the wall's Parakeet hears what was said
 * (src/lib/services/wallEar.js) and the answer is read here in the wall's
 * Phonon voice. That works the same on a computer's browser, and nothing
 * goes to the phone's vendor. Without it, the browser's own recogniser and
 * voice stand in.
 */

import { wallSocketUrl, followPairing } from './remoteAuth.js';
import { createEar, earSupport, speakOnPhone, stopSpeaking } from './services/listen.js';
import { canRecord, createWallEar, primeRecorder, speakWithWall, stopWall, wallVoiceStatus } from './services/wallEar.js';
import { primeAudio, playChime } from './services/chime.js';
import {
	CANCEL_PX,
	HOLD_MS,
	LINGER_MS,
	cleanHeard,
	joinSpeech,
	nextPhase,
	pressEnd,
	pressMove,
	pressStart,
	pressTick,
	voiceBlocker,
	wantsAnswer
} from './voiceAgent.js';

const MODE_KEY = 'voice-reply';
const MODES = ['phone', 'wall', 'text'];
const ASK_TIMEOUT_MS = 26000;
const SILENCE_MS = 1500;

export const voice = $state({
	open: false,
	phase: 'idle', // idle | listening | thinking | speaking | error
	latched: false, // tap-opened: stays until closed, listens by itself
	cancel: false, // the finger has slid far enough left
	pressing: false, // the key is held down right now
	heard: '', // what's being heard, live
	said: '', // what was sent
	reply: '', // what the wall answered
	failed: '', // a short reason when something didn't work
	mode: 'phone', // where the answer is read: phone | wall | text
	blocker: '', // why listening can't work here ('' when it can)
	typed: ''
});

/** Read every frame by the orb; plain object so 60 fps updates don't fan out through reactivity. */
export const meter = { level: 0 };

try {
	const saved = localStorage.getItem(MODE_KEY);
	if (MODES.includes(saved)) voice.mode = saved;
} catch {
	/* storage blocked: the default holds */
}

let ws = null;
let waiter = null;
// what the wall's voice box can do for this device (asked when the key is first touched)
let box = { up: false, stt: false, tts: false };
let boxAsked = -Infinity;
let earKind = '';
// this browser gave the page a silent microphone once: its own recogniser for the rest of the visit
let silentMic = false;
let gesture = null;
let holdTimer = 0;
let silenceTimer = 0;
let lingerTimer = 0;
let ear = null;
let startedAt = 0;
// what was heard before the recogniser stopped by itself while the key was still held
let carry = '';

const buzz = (ms = 10) => navigator.vibrate?.(ms);

function setPhase(event) {
	voice.phase = nextPhase(voice.phase, event);
}

/* ---------- the wall ---------- */

function socket() {
	if (ws && ws.readyState <= 1) return ws;
	ws = new WebSocket(wallSocketUrl(location.host));
	ws.onmessage = (e) => {
		try {
			const msg = JSON.parse(e.data);
			if (followPairing(msg)) return;
			if (msg.type === 'tasks-said' && waiter) waiter.resolve({ ok: msg.ok, say: msg.say });
			if (msg.type === 'tasks-error' && waiter) waiter.resolve({ ok: false, say: '' });
		} catch {
			/* not ours */
		}
	};
	ws.onclose = () => {
		waiter?.resolve({ ok: false, say: '', down: true });
		ws = null;
	};
	return ws;
}

function whenOpen(s) {
	if (s.readyState === 1) return Promise.resolve(true);
	return new Promise((resolve) => {
		const t = setTimeout(() => resolve(false), 5000);
		s.addEventListener(
			'open',
			() => {
				clearTimeout(t);
				resolve(true);
			},
			{ once: true }
		);
		s.addEventListener('close', () => resolve(false), { once: true });
	});
}

/** Warm the connection while the finger is still going down, so the answer isn't waiting on a handshake. */
export function warm() {
	try {
		socket();
	} catch {
		/* no socket yet: asked again when sending */
	}
	askBox();
}

/** Ask the wall what its voice box can do, at most once a minute. */
function askBox() {
	if (typeof window === 'undefined' || performance.now() - boxAsked < 60000) return;
	boxAsked = performance.now();
	wallVoiceStatus().then((s) => {
		box = s;
		if (!ear?.listening) ensureEar();
	});
}

// asked as the page loads, so the first press already knows whose ears to use
askBox();

/** Read the answer aloud here: in the wall's voice when it has one, else the browser's. */
async function readAloud(text) {
	if (box.tts && (await speakWithWall(text))) return;
	await speakOnPhone(text);
}

function quiet() {
	stopSpeaking();
	stopWall();
}

async function ask(text) {
	const s = socket();
	if (!(await whenOpen(s))) return { ok: false, say: '', down: true };
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			waiter = null;
			resolve({ ok: false, say: '', slow: true });
		}, ASK_TIMEOUT_MS);
		waiter = {
			resolve: (r) => {
				clearTimeout(timer);
				waiter = null;
				resolve(r);
			}
		};
		s.send(JSON.stringify({ type: 'tasks', op: 'say', text }));
	});
}

/* ---------- the conversation ---------- */

function clearTimers() {
	clearTimeout(holdTimer);
	clearTimeout(silenceTimer);
	clearTimeout(lingerTimer);
}

async function deliver(raw) {
	const text = cleanHeard(raw);
	voice.heard = '';
	if (!text) {
		voice.said = '';
		voice.reply = 'I didn’t catch anything. Hold the mic and say it again.';
		voice.phase = 'idle';
		lingerThenClose();
		return;
	}
	voice.said = text;
	voice.reply = '';
	voice.failed = '';
	setPhase('sent');
	const answer = await ask(text);
	if (!voice.open) return; // closed while the wall was thinking
	if (!answer.say) {
		voice.failed = answer.down ? 'The display isn’t answering.' : answer.slow ? 'That took too long.' : 'The display didn’t answer that.';
		setPhase('fail');
		playChime('error');
		lingerThenClose(4000);
		return;
	}
	voice.reply = answer.say;
	setPhase('answer');
	playChime('tap');
	if (voice.mode === 'wall' && ws?.readyState === 1) ws.send(JSON.stringify({ type: 'voice', op: 'say', text: answer.say }));
	if (voice.mode === 'phone') await readAloud(answer.say);
	else await new Promise((r) => setTimeout(r, Math.min(4000, 600 + answer.say.length * 28)));
	if (!voice.open) return;
	setPhase('spoken');
	// it asked something back: the next thing said is the answer, no key needed
	if (wantsAnswer(answer.say) && !voice.blocker) {
		voice.latched = true;
		listen();
		return;
	}
	lingerThenClose();
}

function lingerThenClose(extra = 0) {
	clearTimeout(lingerTimer);
	if (voice.latched) return; // tap-opened stays until closed
	const ms = Math.max(LINGER_MS, voice.reply.length * 55) + extra;
	lingerTimer = setTimeout(close, ms);
}

function listen() {
	if (voice.blocker || !ear) return false;
	quiet();
	clearTimeout(lingerTimer);
	voice.heard = carry;
	voice.cancel = false;
	meter.level = 0;
	if (!ear.start()) {
		voice.failed = 'The microphone didn’t start.';
		setPhase('fail');
		return false;
	}
	startedAt = performance.now();
	voice.phase = 'listening';
	buzz(8);
	return true;
}

function ensureEar() {
	// the wall's ears when it has them and this device can record; the browser's otherwise
	const kind = box.stt && canRecord() && !silentMic ? 'wall' : 'browser';
	if (ear && earKind === kind) return;
	ear?.abort();
	earKind = kind;
	voice.blocker = voiceBlocker({ ...earSupport(), wallEars: kind === 'wall' });
	const make = kind === 'wall' ? createWallEar : createEar;
	ear = make({
		// tap-to-talk ends itself after a pause; a held key ends on release
		autoStop: () => voice.latched && !voice.pressing,
		onInterim: (text) => {
			voice.heard = joinSpeech(carry, text);
			clearTimeout(silenceTimer);
			// tap-opened listening ends itself after a pause (the wall's ears notice it themselves);
			// held listening ends on release
			if (earKind === 'browser' && voice.latched && !voice.pressing && text) silenceTimer = setTimeout(() => ear?.stop(), SILENCE_MS);
		},
		onLevel: (v) => {
			meter.level = v;
		},
		onFinal: (text) => {
			clearTimeout(silenceTimer);
			meter.level = 0;
			if (voice.phase === 'idle' && !voice.open) return;
			if (cancelled) return void (cancelled = false);
			// the phone's recogniser gave up on its own (a pause, a time limit) while the
			// key is still down: keep what it heard and listen on, so letting go is what sends
			if (voice.pressing && voice.open && !voice.latched) {
				carry = joinSpeech(carry, text);
				setTimeout(() => voice.pressing && voice.open && listen(), 60);
				return;
			}
			text = joinSpeech(carry, text);
			carry = '';
			// the microphone itself was refused: the note on the sheet says so, nothing to "not catch"
			if (!text && voice.blocker) {
				voice.phase = 'idle';
				return;
			}
			deliver(text);
		},
		onEnd: () => {
			meter.level = 0;
		},
		onError: (code) => {
			meter.level = 0;
			if (code === 'denied') {
				voice.blocker = 'The microphone is blocked for this page. Allow it in your browser’s site settings. Typing works meanwhile.';
				voice.failed = '';
			} else if (code === 'no-audio') {
				// this browser gave the page a silent microphone: the browser's own recogniser takes over
				silentMic = true;
				ensureEar();
				if (voice.open && !voice.blocker) listen();
				return;
			} else if (code === 'wall-ears') {
				voice.failed = 'The display couldn’t hear that. Try again, or type it.';
				box = { ...box, stt: false };
				boxAsked = -Infinity;
			} else voice.failed = 'Listening stopped unexpectedly.';
			voice.phase = 'idle';
		}
	});
}

let cancelled = false;

/* ---------- the key (src/lib/components/VoiceKey.svelte) ---------- */

export function pressDown(e) {
	primeAudio();
	primeRecorder();
	warm();
	ensureEar();
	carry = '';
	gesture = pressStart(e.clientX, e.clientY, performance.now());
	voice.pressing = true;
	voice.cancel = false;
	clearTimeout(holdTimer);
	holdTimer = setTimeout(() => {
		gesture = pressTick(gesture, performance.now());
		if (gesture?.mode !== 'hold') return;
		buzz(14);
		voice.open = true;
		voice.latched = false;
		voice.said = '';
		voice.reply = '';
		voice.failed = '';
		if (!listen()) voice.latched = true; // can't listen: the sheet still rises, for typing
	}, HOLD_MS);
}

export function pressMoved(e) {
	if (!gesture) return;
	const was = gesture.cancel;
	gesture = pressMove(gesture, e.clientX);
	if (gesture.cancel !== was) {
		voice.cancel = Boolean(gesture.cancel);
		buzz(voice.cancel ? 12 : 6);
	}
}

export function pressUp() {
	clearTimeout(holdTimer);
	voice.pressing = false;
	if (!gesture) return;
	const end = pressEnd(gesture, performance.now());
	gesture = null;
	voice.cancel = false;
	if (end.action === 'tap') return tap();
	if (end.action === 'cancel') {
		cancelled = true;
		ear?.abort();
		close();
		return;
	}
	// send: finish listening; the recogniser hands over the last words
	if (voice.phase === 'listening' && ear?.listening) ear.stop();
	else if (voice.phase === 'listening' || (voice.phase === 'idle' && (carry || voice.heard))) {
		// it had already stopped (between restarts): send what was kept
		const said = joinSpeech(carry, voice.heard);
		carry = '';
		deliver(said);
	} else if (voice.phase === 'idle' && voice.typed) sendTyped();
}

export function pressCancelled() {
	// the system took the touch (a call, a swipe from the edge)
	clearTimeout(holdTimer);
	voice.pressing = false;
	gesture = null;
	voice.cancel = false;
	if (voice.open && voice.phase === 'listening' && !voice.latched) {
		cancelled = true;
		ear?.abort();
		close();
	}
}

/** A tap (or the keyboard): open latched, or toggle listening when already open. */
export function tap() {
	primeRecorder();
	ensureEar();
	if (!voice.open) {
		voice.open = true;
		voice.latched = true;
		voice.said = '';
		voice.reply = '';
		voice.failed = '';
		voice.heard = '';
		if (!voice.blocker) listen();
		return;
	}
	voice.latched = true;
	if (voice.phase === 'listening') ear?.stop();
	else if (voice.phase !== 'thinking') listen();
}

export function sendTyped() {
	const text = voice.typed.trim();
	if (!text) return;
	voice.typed = '';
	ear?.abort();
	voice.phase = 'idle';
	deliver(text);
}

export function sendSuggestion(text) {
	voice.typed = '';
	deliver(text);
}

export function setMode(mode) {
	if (!MODES.includes(mode)) return;
	voice.mode = mode;
	if (mode !== 'phone') quiet();
	try {
		localStorage.setItem(MODE_KEY, mode);
	} catch {
		/* the choice just lasts this visit */
	}
}

export function close() {
	carry = '';
	clearTimers();
	cancelled = false;
	ear?.abort();
	quiet();
	waiter?.resolve({ ok: false, say: '' });
	meter.level = 0;
	voice.open = false;
	voice.latched = false;
	voice.pressing = false;
	voice.cancel = false;
	voice.phase = 'idle';
	voice.heard = '';
}

/** Keep the sheet up while someone is reading or touching it. */
export function keepOpen() {
	clearTimeout(lingerTimer);
}

export const HOLD = { ms: HOLD_MS, cancelPx: CANCEL_PX };
export const MODE_LABELS = { phone: 'This device', wall: 'The wall', text: 'Text only' };
