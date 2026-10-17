// The phone's ears: the browser's speech recogniser, plus (where the phone
// lets both share the microphone) a level meter the listening orb follows.
//
//   const ear = createEar({ onInterim, onFinal, onLevel, onEnd, onError });
//   ear.start();  // begin listening
//   ear.stop();   // finish: the last words still arrive through onFinal
//   ear.abort();  // throw it away
//
// iPhone Safari can't run the recogniser and a second microphone stream at
// once without one of them going deaf, so there the orb follows the words
// as they arrive instead (src/lib/voiceAgent.js wordPulse).

import { levelFromRms, rmsOf, wordPulse } from '../voiceAgent.js';

const IOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);

export function recognitionCtor() {
	if (typeof window === 'undefined') return null;
	return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** What this phone can do, for voiceBlocker(). */
export function earSupport() {
	if (typeof window === 'undefined') return { secure: true, recognition: true, standalone: false };
	return {
		secure: window.isSecureContext !== false,
		recognition: Boolean(recognitionCtor()),
		standalone: Boolean(navigator.standalone) || matchMedia('(display-mode: standalone)').matches
	};
}

export function createEar({ lang = 'en-US', onInterim = () => {}, onFinal = () => {}, onLevel = () => {}, onEnd = () => {}, onError = () => {} } = {}) {
	const Ctor = recognitionCtor();
	let rec = null;
	let active = false;
	let aborted = false;
	let heard = '';
	let finalText = '';
	let meter = null;

	async function startMeter() {
		if (IOS || !navigator.mediaDevices?.getUserMedia) return;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
			if (!active) {
				stream.getTracks().forEach((t) => t.stop());
				return;
			}
			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			const ctx = new AudioCtx();
			const src = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 512;
			src.connect(analyser);
			const buf = new Uint8Array(analyser.fftSize);
			let raf = 0;
			const tick = () => {
				analyser.getByteTimeDomainData(buf);
				onLevel(levelFromRms(rmsOf(buf)));
				raf = requestAnimationFrame(tick);
			};
			tick();
			meter = () => {
				cancelAnimationFrame(raf);
				stream.getTracks().forEach((t) => t.stop());
				ctx.close().catch(() => {});
			};
		} catch {
			/* no second stream: the orb follows the words instead */
		}
	}

	function stopMeter() {
		meter?.();
		meter = null;
	}

	function start() {
		if (!Ctor || active) return false;
		aborted = false;
		heard = '';
		finalText = '';
		rec = new Ctor();
		rec.lang = lang;
		rec.continuous = true;
		rec.interimResults = true;
		rec.maxAlternatives = 1;
		rec.onresult = (e) => {
			let interim = '';
			let fin = '';
			for (let i = 0; i < e.results.length; i++) {
				const r = e.results[i];
				if (r.isFinal) fin += r[0].transcript;
				else interim += r[0].transcript;
			}
			finalText = fin;
			const text = `${fin} ${interim}`.replace(/\s+/g, ' ').trim();
			const pulse = wordPulse(heard, text);
			heard = text;
			if (pulse && !meter) onLevel(pulse);
			onInterim(text);
		};
		rec.onerror = (e) => {
			// 'no-speech' and 'aborted' are just silence or our own stop
			if (e.error === 'no-speech' || e.error === 'aborted') return;
			onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error || 'failed');
		};
		rec.onend = () => {
			const was = active;
			active = false;
			stopMeter();
			if (!was) return;
			onEnd();
			if (!aborted) onFinal((finalText || heard).trim());
		};
		active = true;
		try {
			rec.start();
		} catch {
			active = false;
			return false;
		}
		startMeter();
		return true;
	}

	function stop() {
		if (!active) return;
		try {
			rec.stop();
		} catch {
			/* already stopping */
		}
	}

	function abort() {
		aborted = true;
		if (!active) return;
		try {
			rec.abort();
		} catch {
			/* already stopped */
		}
		active = false;
		stopMeter();
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
			return Boolean(Ctor);
		}
	};
}

/** Read a sentence aloud on the phone. Resolves when it's done (or can't). */
export function speakOnPhone(text, { onBoundary = () => {} } = {}) {
	return new Promise((resolve) => {
		const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
		if (!synth || !text) return resolve(false);
		try {
			synth.cancel();
			const u = new SpeechSynthesisUtterance(text);
			const voices = synth.getVoices();
			const pick =
				voices.find((v) => /en[-_]US/i.test(v.lang) && /(enhanced|premium|siri|natural)/i.test(v.name)) ||
				voices.find((v) => /en[-_]US/i.test(v.lang)) ||
				voices.find((v) => /^en/i.test(v.lang));
			if (pick) u.voice = pick;
			u.rate = 1.02;
			u.onboundary = () => onBoundary();
			u.onend = () => resolve(true);
			u.onerror = () => resolve(false);
			synth.speak(u);
		} catch {
			resolve(false);
		}
	});
}

export function stopSpeaking() {
	try {
		window.speechSynthesis?.cancel();
	} catch {
		/* nothing speaking */
	}
}
