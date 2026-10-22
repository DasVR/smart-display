// The wall's own ears and voice, from a phone or a computer: what you say is
// recorded here and heard by the wall's Parakeet (the same model as its
// microphone), and the answer is read in the wall's Phonon voice. The audio
// goes to the wall only, never to a phone vendor. Server side:
// src/lib/server/voiceBox.js (/v1/audio/*).
//
//   const ear = createWallEar({ onInterim, onFinal, onLevel, onEnd, onError, autoStop });
//   ear.start(); ear.stop(); ear.abort();   // the same as listen.js createEar
//
// Words arrive as you speak (a draft every second and a half or so), and the
// whole sentence is heard again when you let go.

import { deviceToken } from '../remoteAuth.js';
import { downsample, encodeWav, levelFromRms, pauseStep } from '../voiceAgent.js';

const DRAFT_MS = 1500;
// no sound at all this long after starting: the microphone isn't really on
const NO_AUDIO_MS = 1500;

// One audio context for every sentence, made while a finger is on the screen:
// iPhone keeps a context made any later (the hold starts 0.2 s after the
// touch) suspended, and then nothing is ever recorded.
let shared = null;

function context() {
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	if (!shared || shared.state === 'closed') shared = new AudioCtx();
	if (shared.state === 'suspended') shared.resume().catch(() => {});
	return shared;
}

/** Call from the touch itself (pointerdown), before listening starts. */
export function primeRecorder() {
	if (canRecord()) context();
}
const DRAFT_UNTIL_S = 15;
const MAX_S = 60;

function headers(extra = {}) {
	const token = deviceToken();
	return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** What the wall's voice box can do for this device: { up, stt, tts, voices } (all false when it can't be asked). */
export async function wallVoiceStatus() {
	try {
		const res = await fetch('/api/voice/box', { headers: headers(), cache: 'no-store' });
		if (!res.ok) return { up: false, stt: false, tts: false, voices: [] };
		return await res.json();
	} catch {
		return { up: false, stt: false, tts: false, voices: [] };
	}
}

/** Recording needs the microphone, which needs a secure page. */
export function canRecord() {
	return typeof window !== 'undefined' && window.isSecureContext !== false && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.AudioContext || window.webkitAudioContext);
}

async function hear(samples, rate, signal) {
	const wav = encodeWav(downsample(samples, rate, 16000), 16000);
	const res = await fetch('/v1/audio/transcriptions?response_format=json', {
		method: 'POST',
		headers: headers({ 'Content-Type': 'audio/wav' }),
		body: wav,
		signal
	});
	if (!res.ok) throw new Error(String(res.status));
	return String((await res.json()).text || '').trim();
}

function join(chunks) {
	const n = chunks.reduce((a, c) => a + c.length, 0);
	const out = new Float32Array(n);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

export function createWallEar({ onInterim = () => {}, onFinal = () => {}, onLevel = () => {}, onEnd = () => {}, onError = () => {}, autoStop = () => false } = {}) {
	let active = false;
	let aborted = false;
	let stream = null;
	let ctx = null;
	let node = null;
	let chunks = [];
	let rate = 48000;
	let draftTimer = 0;
	let drafting = null;
	let pause = null;
	let last = 0;
	let finishing = null;
	let src = null;
	let watchdog = 0;
	let heardAny = false;

	function release() {
		clearInterval(draftTimer);
		clearTimeout(watchdog);
		try {
			node?.disconnect();
			src?.disconnect();
		} catch {
			/* already gone */
		}
		stream?.getTracks().forEach((t) => t.stop());
		// the context stays: it is shared, and made while a finger was down
		node = stream = src = ctx = null;
	}

	function seconds() {
		return chunks.reduce((a, c) => a + c.length, 0) / rate;
	}

	async function draft() {
		if (!active || drafting || seconds() < 0.8 || seconds() > DRAFT_UNTIL_S) return;
		const ctl = new AbortController();
		drafting = ctl;
		try {
			const text = await hear(join(chunks), rate, ctl.signal);
			if (active && text) onInterim(text);
		} catch {
			/* a draft is only a draft: the final hearing still happens */
		} finally {
			drafting = null;
		}
	}

	async function begin() {
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
		} catch (e) {
			fail(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'no-audio');
			return;
		}
		if (!active) return release();
		// the microphone is granted (the permission prompt is over); no sound at all
		// soon after (a paused audio context, a microphone that gives nothing): say
		// so, so the caller listens with the browser's own recogniser instead
		watchdog = setTimeout(() => !heardAny && fail('no-audio'), NO_AUDIO_MS);
		ctx = context();
		// not awaited: a context the browser keeps paused never settles this, and
		// the watchdog below is what notices
		if (ctx.state === 'suspended') ctx.resume().catch(() => {});
		rate = ctx.sampleRate;
		src = ctx.createMediaStreamSource(stream);
		// ScriptProcessor is old but runs everywhere the remote does, iPhone included
		node = ctx.createScriptProcessor(4096, 1, 1);
		node.onaudioprocess = (e) => {
			if (!active) return;
			const data = new Float32Array(e.inputBuffer.getChannelData(0));
			heardAny = true;
			chunks.push(data);
			let sum = 0;
			for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
			const level = levelFromRms(Math.sqrt(sum / data.length));
			onLevel(level);
			const t = performance.now();
			pause = pauseStep(pause, level, last ? t - last : 0);
			last = t;
			if ((pause.done && autoStop()) || seconds() >= MAX_S) stop();
		};
		src.connect(node);
		// some browsers only run the processor while it leads somewhere; it writes silence
		node.connect(ctx.destination);
		draftTimer = setInterval(draft, DRAFT_MS);
	}

	/** Listening that never got going: let go of everything and say why. */
	function fail(code) {
		if (!active) return;
		active = false;
		release();
		onLevel(0);
		onEnd();
		onError(code);
	}

	function start() {
		if (active || finishing) return false;
		active = true;
		aborted = false;
		chunks = [];
		heardAny = false;
		pause = null;
		last = 0;
		begin().catch(() => fail('no-audio'));
		return true;
	}

	function stop() {
		if (!active) return;
		active = false;
		drafting?.abort();
		const samples = join(chunks);
		const at = rate;
		release();
		onLevel(0);
		onEnd();
		if (aborted) return;
		if (samples.length < at * 0.3) return onFinal('');
		finishing = hear(samples, at)
			.then((text) => !aborted && onFinal(text))
			.catch(() => {
				if (!aborted) onError('wall-ears');
			})
			.finally(() => {
				finishing = null;
			});
	}

	function abort() {
		aborted = true;
		if (!active) return;
		active = false;
		drafting?.abort();
		release();
		onEnd();
	}

	return {
		start,
		stop,
		abort,
		get listening() {
			return active;
		},
		get supported() {
			return canRecord();
		}
	};
}

let player = null;

/** Read the answer in the wall's voice, on this device. Resolves true once
 *  it has played, false when the wall couldn't make it (so the caller can
 *  fall back to the browser's own voice). */
export async function speakWithWall(text, { voice = '' } = {}) {
	stopWall();
	let url = '';
	try {
		const res = await fetch('/v1/audio/speech', {
			method: 'POST',
			headers: headers({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ input: text, voice, response_format: 'wav' })
		});
		if (!res.ok) return false;
		url = URL.createObjectURL(await res.blob());
	} catch {
		return false;
	}
	return new Promise((resolve) => {
		const audio = new Audio(url);
		player = audio;
		const done = (ok) => {
			URL.revokeObjectURL(url);
			if (player === audio) player = null;
			resolve(ok);
		};
		audio.onended = () => done(true);
		audio.onerror = () => done(false);
		audio.onpause = () => audio.ended || done(true);
		audio.play().catch(() => done(false));
	});
}

export function stopWall() {
	try {
		player?.pause();
	} catch {
		/* nothing playing */
	}
	player = null;
}
