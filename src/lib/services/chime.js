// Soft, synthesized notification tones for Dynamic Island events. No audio
// files, no external generation step — just a couple of gently-filtered
// oscillators per severity, tuned to read as calm and distinct rather than
// like a system alert.

let ctx;

function getContext() {
	if (typeof window === 'undefined') return null;
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	if (!AudioCtx) return null;
	if (!ctx) ctx = new AudioCtx();
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	return ctx;
}

// Each profile is a short sequence of notes. `tone` notes are the original
// soft two-partial tones (sine + detuned triangle through a lowpass); `tick`
// notes are a much shorter, percussive bandpass click for tactile feedback
// (button/tab presses) where a sustained tone would feel sluggish.
const PROFILES = {
	info: [{ freq: 880, peak: 0.19 }],
	ok: [{ freq: 659.25, peak: 0.19 }, { freq: 880, at: 0.11, peak: 0.19 }],
	warn: [{ freq: 784, peak: 0.2 }, { freq: 659.25, at: 0.14, peak: 0.2 }],
	error: [{ freq: 622.25, peak: 0.2 }, { freq: 587.33, at: 0.17, peak: 0.2 }],
	// A brighter three-note lift for the island opening on now-playing —
	// distinct from the severity tones since it's good news, not a notice.
	music: [
		{ freq: 523.25, peak: 0.19 },
		{ freq: 659.25, at: 0.09, peak: 0.19 },
		{ freq: 783.99, at: 0.18, peak: 0.19 }
	],
	// A fuller ascending three-note lift for a genuine completion (bigger
	// than `ok`, which is reserved for the quieter island-event severity).
	success: [
		{ freq: 587.33, peak: 0.21 },
		{ freq: 739.99, at: 0.09, peak: 0.21 },
		{ freq: 987.77, at: 0.18, peak: 0.21 }
	],
	// An urgent alternating alarm for extreme weather (tornado/hurricane
	// warnings) - louder and more insistent than `error`, since these are
	// the one alert category that genuinely deserves to interrupt.
	severe: [
		{ freq: 587.33, peak: 0.3 },
		{ freq: 466.16, at: 0.24, peak: 0.3 },
		{ freq: 587.33, at: 0.48, peak: 0.3 },
		{ freq: 466.16, at: 0.72, peak: 0.3 }
	],
	// A single quiet click for any button/tab tap - present on almost every
	// interaction, so it has to stay small and out of the way.
	tap: [{ freq: 1600, kind: 'tick', dur: 0.05, peak: 0.1 }],
	// Quick two-note blips for moving through the nav in either direction -
	// pitch rises going forward through the tab order, falls going back.
	'swap-next': [
		{ freq: 660, kind: 'tick', dur: 0.07, peak: 0.11 },
		{ freq: 880, kind: 'tick', at: 0.045, dur: 0.09, peak: 0.12 }
	],
	'swap-prev': [
		{ freq: 880, kind: 'tick', dur: 0.07, peak: 0.11 },
		{ freq: 660, kind: 'tick', at: 0.045, dur: 0.09, peak: 0.12 }
	]
};

function tone(context, freq, startAt, peak = 0.19, duration = 0.55) {
	const osc = context.createOscillator();
	const osc2 = context.createOscillator();
	const gain = context.createGain();
	const filter = context.createBiquadFilter();

	filter.type = 'lowpass';
	filter.frequency.value = 2400;

	osc.type = 'sine';
	osc.frequency.value = freq;
	osc2.type = 'triangle';
	osc2.frequency.value = freq;
	osc2.detune.value = 6;

	const t0 = context.currentTime + startAt;
	gain.gain.setValueAtTime(0, t0);
	gain.gain.linearRampToValueAtTime(peak, t0 + 0.03);
	gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

	osc.connect(filter);
	osc2.connect(filter);
	filter.connect(gain);
	gain.connect(context.destination);

	osc.start(t0);
	osc2.start(t0);
	osc.stop(t0 + duration + 0.05);
	osc2.stop(t0 + duration + 0.05);
}

/** A short, percussive bandpass click - for frequent tactile feedback
 *  (taps, tab swaps) where `tone`'s 0.55s sustained sine would feel slow
 *  and pile up under quick repeated presses. */
function tick(context, freq, startAt, peak = 0.1, duration = 0.06) {
	const osc = context.createOscillator();
	const gain = context.createGain();
	const filter = context.createBiquadFilter();

	filter.type = 'bandpass';
	filter.frequency.value = freq;
	filter.Q.value = 5;

	osc.type = 'square';
	osc.frequency.value = freq;

	const t0 = context.currentTime + startAt;
	gain.gain.setValueAtTime(0, t0);
	gain.gain.linearRampToValueAtTime(peak, t0 + 0.004);
	gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

	osc.connect(filter);
	filter.connect(gain);
	gain.connect(context.destination);

	osc.start(t0);
	osc.stop(t0 + duration + 0.02);
}

/** Plays a short calming chime for the given kind: a severity (info/ok/
 *  warn/error), 'music' for the now-playing open, 'success' for a bigger
 *  completion, 'severe' for extreme weather, or 'tap'/'swap-next'/
 *  'swap-prev' for tactile UI feedback.
 *  Safe to call from anywhere (server-rendered code included) — it's a
 *  no-op without a window/AudioContext. */
export function playChime(kind = 'info') {
	const context = getContext();
	if (!context) return;
	const notes = PROFILES[kind] || PROFILES.info;
	notes.forEach((n) => {
		if (n.kind === 'tick') tick(context, n.freq, n.at || 0, n.peak, n.dur);
		else tone(context, n.freq, n.at || 0, n.peak ?? 0.14, n.dur ?? 0.55);
	});
}

/** Unlocks the AudioContext on the first real user gesture, since browsers
 *  block autoplay until then. Safe to call repeatedly. */
export function primeAudio() {
	getContext();
}
