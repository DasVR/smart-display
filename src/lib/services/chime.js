// Tactile, physical-feeling UI sounds — a pencil tapping paper, a creamy
// keycap bottoming out — instead of synth beeps. Every kind plays its clip
// from the sound library (static/sounds/, made once with ElevenLabs: see
// src/lib/sounds/library.js), or a sound made on the phone and assigned to
// it, when there is one. Before the library is generated, every kind is
// synthesized on the fly from filtered noise bursts, which is what makes it
// read as paper/keyboard rather than a notification chime.

import { base } from '$app/paths';
import { volumeTickPitch } from '../chimeKind.js';

export { chimeKindForEvent, islandOwnsChime, volumeTickPitch } from '../chimeKind.js';

let ctx;
let noiseBuffer;

function getContext() {
	if (typeof window === 'undefined') return null;
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	if (!AudioCtx) return null;
	if (!ctx) {
		ctx = new AudioCtx();
		loadLibrary(ctx);
		reloadCustomSounds();
	}
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	return ctx;
}

/* ---------- the sound library (src/lib/sounds/library.js) ----------
   Generated clips in static/sounds/, listed by static/sounds/index.json.
   All of them are fetched and decoded once, up front, so a sound plays the
   instant it's asked for. Until then (or with no files at all) every kind
   falls back to the synthesized taps below. */
const samples = new Map(); // name -> { buffer, gain }

async function loadLibrary(context) {
	try {
		const res = await fetch(`${base}/sounds/index.json`, { cache: 'no-cache' });
		if (!res.ok) return;
		const { sounds = {} } = await res.json();
		await Promise.all(
			Object.entries(sounds).map(async ([name, meta]) => {
				try {
					const r = await fetch(`${base}/sounds/${encodeURIComponent(name)}.mp3`);
					if (!r.ok) return;
					const buffer = await context.decodeAudioData(await r.arrayBuffer());
					samples.set(name, { buffer, offset: leadingSilence(buffer), gain: Math.min(1, Math.max(0, Number(meta?.gain) || 0.6)) });
				} catch {
					/* this one stays synthesized */
				}
			})
		);
	} catch {
		/* no library: synth only */
	}
}

/* ---------- sounds made on the phone (src/lib/server/soundHub.js) ----------
   Kept on the kiosk, listed by /api/sounds/custom. A custom sound can be
   assigned to a library kind, and then plays in its place everywhere. */
const custom = new Map(); // name -> { buffer, gain, made }
let assigned = {}; // kind -> custom name

/** (Re)read the custom sounds. Called at startup and when the wall says they changed. */
export async function reloadCustomSounds() {
	const context = getContext();
	if (!context) return;
	try {
		const res = await fetch('/api/sounds/custom', { cache: 'no-cache' });
		if (!res.ok) return;
		const { sounds = {}, assign = {} } = await res.json();
		await Promise.all(
			Object.entries(sounds).map(async ([name, meta]) => {
				if (custom.get(name)?.made === meta.made) return;
				try {
					const r = await fetch(`/api/sounds/custom/${encodeURIComponent(name)}.mp3?v=${meta.made || 0}`);
					if (!r.ok) return;
					const buffer = await context.decodeAudioData(await r.arrayBuffer());
					custom.set(name, { buffer, offset: leadingSilence(buffer), gain: Math.min(1, Math.max(0, Number(meta.gain) || 0.6)), made: meta.made });
				} catch {
					/* this one is skipped */
				}
			})
		);
		for (const name of [...custom.keys()]) if (!sounds[name]) custom.delete(name);
		assigned = assign;
	} catch {
		/* no custom sounds (the static demo has no server) */
	}
}

/** Play a sound made on the phone by its own name. */
export function playCustom(name) {
	const context = getContext();
	return context ? playBuffer(context, custom.get(name)) : false;
}

/** Seconds of near-silence at the start of a clip. Generated clips often
 *  open with a few quiet milliseconds; skipping them makes a tap feel instant. */
function leadingSilence(buffer) {
	const data = buffer.getChannelData(0);
	const limit = Math.min(data.length, Math.floor(buffer.sampleRate * 0.25));
	for (let i = 0; i < limit; i++) if (Math.abs(data[i]) > 0.01) return Math.max(0, i - Math.floor(buffer.sampleRate * 0.002)) / buffer.sampleRate;
	return 0;
}

function playBuffer(context, s, rate = 1) {
	if (!s) return false;
	const src = context.createBufferSource();
	const gain = context.createGain();
	src.buffer = s.buffer;
	src.playbackRate.value = rate;
	gain.gain.value = s.gain;
	src.connect(gain);
	gain.connect(context.destination);
	src.start(0, s.offset || 0);
	return true;
}

function playSample(context, name) {
	// a sound assigned from the phone wins over the built-in one for the same event
	if (playBuffer(context, custom.get(assigned[name]))) return true;
	return playBuffer(context, samples.get(name));
}

/** Library sounds with no synth profile of their own borrow one. */
const SYNTH_STAND_IN = {
	timer: 'warn',
	reminder: 'info',
	announce: 'ok',
	approval: 'warn',
	morning: 'music',
	goodnight: 'info'
};

/** A couple of seconds of white noise, generated once and reused as the
 *  source for every paper/key sound — cheaper than building a fresh buffer
 *  per hit, and there's no audible seam since each hit only ever plays a
 *  short randomly-offset slice of it. */
function getNoiseBuffer(context) {
	if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer;
	const length = context.sampleRate * 2;
	const buffer = context.createBuffer(1, length, context.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
	noiseBuffer = buffer;
	return buffer;
}

function noiseSource(context) {
	const buffer = getNoiseBuffer(context);
	const src = context.createBufferSource();
	src.buffer = buffer;
	// A random start offset, used when the source is played, so back-to-back
	// hits (a nav swipe, a fast tap) never sound like the exact same grain
	// of noise repeating.
	src.randomOffset = Math.random() * (buffer.duration - 0.3);
	return src;
}

/** A soft pencil/fingertip tap on paper: band-limited noise with a fast
 *  attack and a short, slightly papery decay. `tone` (0..1) shifts the
 *  filter up for a brighter "tap" or down for a duller "thump". */
function paperTap(context, { at = 0, peak = 0.16, tone = 0.5, dur = 0.09 } = {}) {
	const t0 = context.currentTime + at;
	const src = noiseSource(context);
	const band = context.createBiquadFilter();
	const hp = context.createBiquadFilter();
	const gain = context.createGain();

	const centerFreq = 900 + tone * 2200 + (Math.random() * 200 - 100);
	band.type = 'bandpass';
	band.frequency.value = centerFreq;
	band.Q.value = 0.9;
	hp.type = 'highpass';
	hp.frequency.value = 300;

	gain.gain.setValueAtTime(0, t0);
	gain.gain.linearRampToValueAtTime(peak, t0 + 0.006);
	gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

	src.connect(band);
	band.connect(hp);
	hp.connect(gain);
	gain.connect(context.destination);

	src.start(t0, src.randomOffset);
	src.stop(t0 + dur + 0.02);
}

/** A quick noise sweep with a rising or falling filter — a pencil scribble
 *  or a page flick, used for the bigger "something finished" moments where
 *  a single tap would feel too small. `dir` is 1 for a rising scribble, -1
 *  for a falling one. */
function scribble(context, { at = 0, peak = 0.16, dir = 1, dur = 0.22 } = {}) {
	const t0 = context.currentTime + at;
	const src = noiseSource(context);
	const band = context.createBiquadFilter();
	const gain = context.createGain();

	const from = dir > 0 ? 700 : 3200;
	const to = dir > 0 ? 3200 : 700;
	band.type = 'bandpass';
	band.Q.value = 1.1;
	band.frequency.setValueAtTime(from, t0);
	band.frequency.exponentialRampToValueAtTime(to, t0 + dur);

	gain.gain.setValueAtTime(0, t0);
	gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
	gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

	src.connect(band);
	band.connect(gain);
	gain.connect(context.destination);

	src.start(t0, src.randomOffset);
	src.stop(t0 + dur + 0.02);
}

/** A mechanical keycap press: a short bright "click" transient (the switch
 *  actuating) layered under a slightly-delayed lower "thock" (the keycap
 *  bottoming out on the plate) — the two-part sound real keyboard switches
 *  make. `pitch` (0..1) picks a keycap size/material, low pitch reading as
 *  a bigger cap (spacebar-ish), high pitch as a small one. */
function keyClick(context, { at = 0, peak = 0.14, pitch = 0.5 } = {}) {
	const t0 = context.currentTime + at;
	const jitter = 1 + (Math.random() * 0.06 - 0.03);

	// Click: the switch actuating.
	const clickSrc = noiseSource(context);
	const clickFilter = context.createBiquadFilter();
	const clickGain = context.createGain();
	clickFilter.type = 'highpass';
	clickFilter.frequency.value = (2600 + pitch * 1800) * jitter;
	clickGain.gain.setValueAtTime(0, t0);
	clickGain.gain.linearRampToValueAtTime(peak, t0 + 0.002);
	clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02);
	clickSrc.connect(clickFilter);
	clickFilter.connect(clickGain);
	clickGain.connect(context.destination);
	clickSrc.start(t0, clickSrc.randomOffset);
	clickSrc.stop(t0 + 0.03);

	// Thock: the cap bottoming out, a beat later and an octave or so lower.
	const thockAt = t0 + 0.008;
	const thockSrc = noiseSource(context);
	const thockFilter = context.createBiquadFilter();
	const thockGain = context.createGain();
	thockFilter.type = 'bandpass';
	thockFilter.frequency.value = (500 + pitch * 700) * jitter;
	thockFilter.Q.value = 2.2;
	thockGain.gain.setValueAtTime(0, thockAt);
	thockGain.gain.linearRampToValueAtTime(peak * 0.85, thockAt + 0.004);
	thockGain.gain.exponentialRampToValueAtTime(0.0001, thockAt + 0.05);
	thockSrc.connect(thockFilter);
	thockFilter.connect(thockGain);
	thockGain.connect(context.destination);
	thockSrc.start(thockAt, thockSrc.randomOffset);
	thockSrc.stop(thockAt + 0.06);
}

// Each profile is a short sequence of hits. `kind` picks which "instrument"
// plays the hit: `key` for a keycap press (nav taps/swipes — the most
// frequent interaction, so it's the one that should feel like typing),
// `tap` for a paper tap (ambient/notification severities), or `scribble`
// for a fast pencil sweep (bigger completions).
const PROFILES = {
	info: [{ kind: 'tap', tone: 0.55, peak: 0.17 }],
	ok: [{ kind: 'tap', tone: 0.5, peak: 0.16 }, { kind: 'tap', at: 0.1, tone: 0.7, peak: 0.17 }],
	warn: [{ kind: 'tap', tone: 0.35, peak: 0.19 }, { kind: 'tap', at: 0.12, tone: 0.3, peak: 0.19 }],
	error: [{ kind: 'tap', tone: 0.2, peak: 0.2, dur: 0.12 }, { kind: 'tap', at: 0.14, tone: 0.15, peak: 0.2, dur: 0.14 }],
	// A little three-tap flourish for the island opening on now-playing —
	// brighter and quicker than the severity taps since it's good news.
	music: [
		{ kind: 'tap', tone: 0.5, peak: 0.16 },
		{ kind: 'tap', at: 0.08, tone: 0.65, peak: 0.17 },
		{ kind: 'tap', at: 0.16, tone: 0.8, peak: 0.18 }
	],
	// A quick rising scribble for a genuine completion — bigger than `ok`,
	// which is reserved for the quieter island-event severity.
	success: [{ kind: 'scribble', dir: 1, peak: 0.19 }],
	// An urgent, fast alternating tap-tap for extreme weather (tornado/
	// hurricane warnings) — louder and more insistent than `error`, since
	// this is the one alert category that genuinely deserves to interrupt.
	severe: [
		{ kind: 'tap', tone: 0.25, peak: 0.28, dur: 0.1 },
		{ kind: 'tap', at: 0.16, tone: 0.2, peak: 0.28, dur: 0.1 },
		{ kind: 'tap', at: 0.32, tone: 0.25, peak: 0.28, dur: 0.1 },
		{ kind: 'tap', at: 0.48, tone: 0.2, peak: 0.28, dur: 0.1 }
	],
	// A single keycap press for any button/tab tap - present on almost
	// every interaction, so it has to stay small and out of the way.
	tap: [{ kind: 'key', pitch: 0.5, peak: 0.13 }],
	// Two-key blips for moving through the nav in either direction - pitch
	// rises going forward through the tab order, falls going back, the way
	// adjacent keys on a board read as a rising or falling run.
	'swap-next': [
		{ kind: 'key', at: 0, pitch: 0.35, peak: 0.13 },
		{ kind: 'key', at: 0.055, pitch: 0.65, peak: 0.14 }
	],
	'swap-prev': [
		{ kind: 'key', at: 0, pitch: 0.65, peak: 0.13 },
		{ kind: 'key', at: 0.055, pitch: 0.35, peak: 0.14 }
	],
	// Volume confirmation on the island (drag ticks use playVolumeTick).
	volume: [{ kind: 'key', pitch: 0.55, peak: 0.14 }],
	mute: [{ kind: 'key', pitch: 0.12, peak: 0.15 }],
	unmute: [{ kind: 'key', pitch: 0.78, peak: 0.15 }],
	// Night schedule saved: two paper taps, not the same pair as `ok`.
	schedule: [
		{ kind: 'tap', tone: 0.42, peak: 0.16 },
		{ kind: 'tap', at: 0.08, tone: 0.58, peak: 0.16 }
	],
	// apt / fwupd applying packages or firmware.
	install: [
		{ kind: 'tap', tone: 0.4, peak: 0.15 },
		{ kind: 'tap', at: 0.09, tone: 0.4, peak: 0.15 },
		{ kind: 'tap', at: 0.18, tone: 0.4, peak: 0.15 }
	],
	// OS package or firmware updates are waiting.
	update: [
		{ kind: 'tap', tone: 0.32, peak: 0.18 },
		{ kind: 'tap', at: 0.11, tone: 0.22, peak: 0.18 }
	],
	// Distinct, layered finish flourishes so Cursor / Claude / Hermes /
	// Ollama read from across the room. Louder than the quiet island taps.
	'done-cursor': [
		{ kind: 'key', pitch: 0.42, peak: 0.18 },
		{ kind: 'scribble', at: 0.05, dir: 1, peak: 0.28, dur: 0.26 },
		{ kind: 'tap', at: 0.28, tone: 0.78, peak: 0.22 },
		{ kind: 'key', at: 0.4, pitch: 0.82, peak: 0.18 }
	],
	'done-claude': [
		{ kind: 'tap', tone: 0.5, peak: 0.2 },
		{ kind: 'tap', at: 0.09, tone: 0.68, peak: 0.21 },
		{ kind: 'scribble', at: 0.16, dir: 1, peak: 0.28, dur: 0.24 },
		{ kind: 'key', at: 0.42, pitch: 0.74, peak: 0.2 }
	],
	'done-hermes': [
		{ kind: 'key', pitch: 0.38, peak: 0.18 },
		{ kind: 'tap', at: 0.07, tone: 0.55, peak: 0.2 },
		{ kind: 'tap', at: 0.14, tone: 0.72, peak: 0.2 },
		{ kind: 'scribble', at: 0.22, dir: 1, peak: 0.26, dur: 0.22 }
	],
	'done-ollama': [
		{ kind: 'tap', tone: 0.45, peak: 0.19 },
		{ kind: 'scribble', at: 0.08, dir: 1, peak: 0.24, dur: 0.22 },
		{ kind: 'tap', at: 0.3, tone: 0.72, peak: 0.2 }
	],
	// A two-key start so a run beginning is audible without stealing the
	// finish flourish.
	working: [
		{ kind: 'key', pitch: 0.38, peak: 0.16 },
		{ kind: 'key', at: 0.08, pitch: 0.64, peak: 0.17 }
	]
};

/** Plays a short tactile sound for the given kind. Safe to call from
 *  anywhere (server-rendered code included) — it's a no-op without a
 *  window/AudioContext. */
export function playChime(kind = 'info') {
	const context = getContext();
	if (!context) return;
	if (playSample(context, kind)) return;
	const hits = PROFILES[kind] || PROFILES[SYNTH_STAND_IN[kind]] || PROFILES.info;
	hits.forEach((h) => {
		const at = h.at || 0;
		if (h.kind === 'key') keyClick(context, { at, peak: h.peak, pitch: h.pitch });
		else if (h.kind === 'scribble') scribble(context, { at, peak: h.peak, dir: h.dir, dur: h.dur });
		else paperTap(context, { at, peak: h.peak, tone: h.tone, dur: h.dur });
	});
}

/** The volume sound, its pitch following the slider (0 quiet/low, 1 bright/high).
 *  The library's (or an assigned) clip is played faster or slower; without one,
 *  a synthesized keycap. */
export function playVolumeTick(level) {
	const context = getContext();
	if (!context) return;
	const pitch = volumeTickPitch(level);
	const clip = custom.get(assigned.volume) || samples.get('volume');
	if (playBuffer(context, clip, 0.8 + pitch * 0.5)) return;
	keyClick(context, { peak: 0.12, pitch });
}

/** Unlocks the AudioContext on the first real user gesture, since browsers
 *  block autoplay until then. Safe to call repeatedly. */
export function primeAudio() {
	getContext();
}
