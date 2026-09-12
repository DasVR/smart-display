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

// Each profile is a short sequence of {freq, at} notes, all soft two-partial
// tones (sine + detuned triangle through a lowpass) so nothing buzzes.
const PROFILES = {
	info: [{ freq: 880 }],
	ok: [{ freq: 659.25 }, { freq: 880, at: 0.11 }],
	warn: [{ freq: 784 }, { freq: 659.25, at: 0.14 }],
	error: [{ freq: 622.25 }, { freq: 587.33, at: 0.17 }]
};

function tone(context, freq, startAt, peak = 0.14, duration = 0.55) {
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

/** Plays a short calming chime for the given island-event severity. Safe to
 *  call from anywhere (server-rendered code included) — it's a no-op without
 *  a window/AudioContext. */
export function playChime(severity = 'info') {
	const context = getContext();
	if (!context) return;
	const notes = PROFILES[severity] || PROFILES.info;
	notes.forEach((n) => tone(context, n.freq, n.at || 0));
}

/** Unlocks the AudioContext on the first real user gesture, since browsers
 *  block autoplay until then. Safe to call repeatedly. */
export function primeAudio() {
	getContext();
}
