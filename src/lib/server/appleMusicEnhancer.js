/**
 * The wall's own sound for Apple Music (ours, not Cider's code): a small Web
 * Audio chain between MusicKit's <audio> element and the speakers, run
 * inside the headless player (src/lib/server/appleMusic.js injects it before
 * the page loads).
 *
 * A 256 kbps AAC encoder trims the very top and thins the bottom a little.
 * The chain gives a gentle lift back and keeps it from clipping:
 *
 *   headroom -2 dB -> low shelf 105 Hz +1.5 dB -> presence dip 2.8 kHz -0.8 dB
 *   -> high shelf 9.5 kHz +2 dB -> limiter at -1 dBFS -> level meter -> out
 *
 * Off means bypass: the same element straight to the meter and out, so the
 * switch is instant and clean. The meter is how the server notices if
 * protected audio ever comes through silent, and switches the chain off.
 *
 * window.__wallEnhancer: { set(on), status() }
 * window.__wallEnhancerOff (set before this runs): don't touch the audio at all.
 */

export const ENHANCER_SETTINGS = {
	headroomDb: -2,
	lowShelf: { frequency: 105, gain: 1.5 },
	presence: { frequency: 2800, Q: 1.0, gain: -0.8 },
	highShelf: { frequency: 9500, gain: 2.0 },
	limiter: { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.12 }
};

function install(settings) {
	if (window.__wallEnhancer || window.__wallEnhancerOff) return;
	const S = settings;
	let ctx = null;
	let input = null;
	let chainIn = null;
	let meter = null;
	let enabled = true;
	let error = '';
	const wired = new WeakSet();
	let wiredCount = 0;

	function graph() {
		ctx = new AudioContext({ latencyHint: 'playback' });
		input = ctx.createGain();
		chainIn = ctx.createGain();
		chainIn.gain.value = Math.pow(10, S.headroomDb / 20);
		const low = ctx.createBiquadFilter();
		low.type = 'lowshelf';
		low.frequency.value = S.lowShelf.frequency;
		low.gain.value = S.lowShelf.gain;
		const mid = ctx.createBiquadFilter();
		mid.type = 'peaking';
		mid.frequency.value = S.presence.frequency;
		mid.Q.value = S.presence.Q;
		mid.gain.value = S.presence.gain;
		const high = ctx.createBiquadFilter();
		high.type = 'highshelf';
		high.frequency.value = S.highShelf.frequency;
		high.gain.value = S.highShelf.gain;
		const limit = ctx.createDynamicsCompressor();
		for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) limit[k].value = S.limiter[k];
		meter = ctx.createAnalyser();
		meter.fftSize = 2048;
		chainIn.connect(low);
		low.connect(mid);
		mid.connect(high);
		high.connect(limit);
		limit.connect(meter);
		meter.connect(ctx.destination);
		route();
	}

	function route() {
		if (!input) return;
		input.disconnect();
		input.connect(enabled ? chainIn : meter);
	}

	function attach(el) {
		if (!el || wired.has(el)) return;
		try {
			if (!ctx) graph();
			ctx.createMediaElementSource(el).connect(input);
			wired.add(el);
			wiredCount += 1;
		} catch (e) {
			error = String(e?.message || e);
		}
	}

	function level() {
		if (!meter) return 0;
		const buf = new Float32Array(meter.fftSize);
		meter.getFloatTimeDomainData(buf);
		let sum = 0;
		for (const v of buf) sum += v * v;
		return Math.sqrt(sum / buf.length);
	}

	// MusicKit starts its element with play(): wire it in on the way
	const play = HTMLMediaElement.prototype.play;
	HTMLMediaElement.prototype.play = function (...args) {
		attach(this);
		if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
		return play.apply(this, args);
	};

	window.__wallEnhancer = {
		set(on) {
			enabled = Boolean(on);
			route();
		},
		status() {
			return { enabled, wired: wiredCount, running: ctx?.state === 'running', sampleRate: ctx?.sampleRate || 0, level: level(), error };
		}
	};
}

/** What the player injects into every page it opens. */
export const ENHANCER_SOURCE = `(${install.toString()})(${JSON.stringify(ENHANCER_SETTINGS)});`;
