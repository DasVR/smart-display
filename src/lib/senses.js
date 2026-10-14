import { KIOSK_VIEWS } from './kioskViews.js';

// The wall's senses: the webcam's microphone and camera, seen from the wall's
// side. Pure helpers shared by the server (src/lib/server/sensesHub.js), the
// phone's Senses page and the tests. The listening and looking happen in a
// separate local process (senses/, Python), which only ever sends numbers and
// words here: never a picture, never sound.

export const DEFAULT_SENSES = {
	// both off until turned on from the phone
	mic: false,
	camera: false,
	// a PipeWire source name (or part of one); '' picks the webcam's own mic
	micSource: '',
	// /dev/videoN or an index; '' is the first camera
	cameraDevice: '',
	// 'body': whole people, any pose, for a camera up high that sees the room;
	// 'face': faces, for a camera at face height
	look: 'body',
	// how much the microphone is turned up in software (1 to 10), for a webcam across the room
	micGain: 3,
	// 'room': a voice barely above the room's noise counts as talking; 'near': it must be clearly louder
	hearFrom: 'room',
	// take the room's steady noise (fan, hum, hiss) out of each phrase: 'off' | 'light' | 'strong'
	noiseSuppress: 'light',
	// cut rumble under 90 Hz and lift the 1 to 4 kHz speech band
	voiceBoost: true,
	// remembered spots: { name, sig: [cx, cy, w, h] in 0..1 picture coords }
	zones: [],
	// a sheet of paper on the floor: its corners (0..1), the map to metres it gives,
	// its size, and how far its near edge is from the camera's wall (metres, optional)
	floorQuad: null,
	floorMap: null,
	paper: 'letter',
	paperWall: null,
	// 'phrase': "hey wall …" spotted by Whisper itself; 'openwakeword': a small
	// always-on model (its own wake word) wakes Whisper
	wakeMode: 'phrase',
	wakeWords: ['hey wall', 'okay wall'],
	wakeModel: 'hey_jarvis',
	// faster-whisper model: tiny.en is quickest, base.en a good default, small.en most accurate
	model: 'base.en',
	language: 'en',
	// someone closer than this counts as "at the wall"
	nearMeters: 1.5,
	// turn the panel on when someone comes up to the wall (never during the night)
	wakePanel: true,
	// show what the wall heard on the island
	captions: true,
	// the camera's field of view until calibrated, and the face width it assumes
	hfov: 70,
	faceWidth: 0.15,
	// set by calibrating (stand 1 m away): pixels, at focalWidth pixels across
	focalPx: null,
	focalWidth: null,
	// notes stop by themselves after this many minutes with nothing said
	notesMinutes: 30,
	// what each spot does: { [spot]: { view: 'calendar' | … | '', lieOff: bool } }
	places: {},
	// turn the screen off when nobody has been seen for this many minutes (0: never)
	awayMinutes: 0
};

export const LOOKS = ['body', 'face'];
export const PAPERS = ['letter', 'a4'];
export const MAX_ZONES = 8;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function cleanZones(list) {
	if (!Array.isArray(list)) return [];
	const seen = new Set();
	const out = [];
	for (const z of list) {
		const name = text(z?.name, 24);
		const sig = Array.isArray(z?.sig) && z.sig.length === 4 && z.sig.every((v) => finite(v) && v >= -0.5 && v <= 1.5) ? z.sig : null;
		if (!name || !sig || seen.has(name.toLowerCase())) continue;
		seen.add(name.toLowerCase());
		out.push({ name, sig: sig.map((v) => Math.round(v * 1e4) / 1e4) });
	}
	return out.slice(0, MAX_ZONES);
}

export const AWAY_CHOICES = [0, 10, 30, 60];

function cleanPlaces(places, zones) {
	const names = new Map(zones.map((z) => [z.name.toLowerCase(), z.name]));
	const out = {};
	if (!places || typeof places !== 'object') return out;
	for (const [key, rule] of Object.entries(places)) {
		const name = names.get(String(key).toLowerCase());
		if (!name || !rule || typeof rule !== 'object') continue;
		const view = KIOSK_VIEWS.includes(rule.view) ? rule.view : '';
		const lieOff = rule.lieOff === true;
		if (view || lieOff) out[name] = { view, lieOff };
	}
	return out;
}

export const WHISPER_MODELS = ['tiny.en', 'base.en', 'small.en', 'tiny', 'base', 'small'];
export const WAKE_MODES = ['phrase', 'openwakeword'];
export const WAKE_MODELS = ['hey_jarvis', 'alexa', 'hey_mycroft', 'hey_rhasspy'];

const num = (v, lo, hi, fallback) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const text = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

/** Settings with every field valid; `patch` over `base`. Unknown keys are dropped. */
export function normalizeSensesSettings(patch = {}, base = DEFAULT_SENSES) {
	const p = patch && typeof patch === 'object' ? patch : {};
	const b = { ...DEFAULT_SENSES, ...base };
	const pick = (k) => (k in p ? p[k] : b[k]);
	let wakeWords = pick('wakeWords');
	if (typeof wakeWords === 'string') wakeWords = wakeWords.split(',');
	wakeWords = (Array.isArray(wakeWords) ? wakeWords : [])
		.map((w) => text(w, 40).toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.slice(0, 6);
	const focalPx = pick('focalPx');
	const floorMap = pick('floorMap');
	const floorQuad = pick('floorQuad');
	const okMap = Array.isArray(floorMap) && floorMap.length === 9 && floorMap.every(finite);
	const okQuad = Array.isArray(floorQuad) && floorQuad.length === 4 && floorQuad.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite));
	const wall = pick('paperWall');
	return {
		mic: Boolean(pick('mic')),
		camera: Boolean(pick('camera')),
		micSource: text(pick('micSource')),
		cameraDevice: text(pick('cameraDevice'), 200),
		look: LOOKS.includes(pick('look')) ? pick('look') : DEFAULT_SENSES.look,
		micGain: num(pick('micGain'), 1, 10, DEFAULT_SENSES.micGain),
		hearFrom: pick('hearFrom') === 'near' ? 'near' : 'room',
		noiseSuppress: ['off', 'light', 'strong'].includes(pick('noiseSuppress')) ? pick('noiseSuppress') : DEFAULT_SENSES.noiseSuppress,
		voiceBoost: pick('voiceBoost') !== false,
		zones: cleanZones(pick('zones')),
		floorQuad: okMap && okQuad ? floorQuad : null,
		floorMap: okMap && okQuad ? floorMap : null,
		paper: PAPERS.includes(pick('paper')) ? pick('paper') : 'letter',
		paperWall: wall == null || wall === '' ? null : num(wall, 0, 10, null),
		wakeMode: WAKE_MODES.includes(pick('wakeMode')) ? pick('wakeMode') : b.wakeMode,
		wakeWords: wakeWords.length ? wakeWords : [...DEFAULT_SENSES.wakeWords],
		wakeModel: WAKE_MODELS.includes(pick('wakeModel')) ? pick('wakeModel') : DEFAULT_SENSES.wakeModel,
		model: WHISPER_MODELS.includes(pick('model')) ? pick('model') : DEFAULT_SENSES.model,
		language: /^(auto|[a-z]{2})$/.test(String(pick('language'))) ? pick('language') : 'en',
		nearMeters: num(pick('nearMeters'), 0.3, 6, DEFAULT_SENSES.nearMeters),
		wakePanel: Boolean(pick('wakePanel')),
		captions: Boolean(pick('captions')),
		hfov: num(pick('hfov'), 30, 160, DEFAULT_SENSES.hfov),
		faceWidth: num(pick('faceWidth'), 0.1, 0.25, DEFAULT_SENSES.faceWidth),
		focalPx: focalPx == null || focalPx === '' ? null : num(focalPx, 20, 20000, null),
		focalWidth: pick('focalWidth') == null ? null : num(pick('focalWidth'), 80, 4000, null),
		notesMinutes: num(pick('notesMinutes'), 1, 240, DEFAULT_SENSES.notesMinutes),
		places: cleanPlaces(pick('places'), cleanZones(pick('zones'))),
		awayMinutes: AWAY_CHOICES.includes(Number(pick('awayMinutes'))) ? Number(pick('awayMinutes')) : 0
	};
}

/* ---------- places: where you are chooses what the wall does ---------- */

// how long you're in a spot before the wall follows (walking past the desk doesn't count)
export const PLACE_DWELL_MS = 8000;
// how long you lie still at night before the screen goes off
export const LIE_OFF_MS = 60000;
// after you change the view yourself, the wall leaves it alone this long
export const MANUAL_GRACE_MS = 120000;

export function newPlaceState() {
	return { zone: null, zoneSince: 0, actedZone: null, lyingSince: null, lieActed: false, emptySince: null, awayActed: false, manualAt: -Infinity };
}

/**
 * One step of the place rules. `state` (from newPlaceState) is kept by the
 * caller; returns what to do now: [{ navigate: view, zone }] or
 * [{ panel: 'off', reason: 'asleep' | 'away' }]. Each happens once per
 * arrival, per lying down, per absence.
 */
export function placeStep(state, { presence, settings, now, quiet = false }) {
	const out = [];
	if (!presence?.camera) return out;
	const places = settings.places || {};
	const zone = presence.count ? presence.zone || null : null;
	if (zone !== state.zone) {
		state.zone = zone;
		state.zoneSince = now;
		state.actedZone = null;
	}
	if (zone && state.actedZone !== zone && now - state.zoneSince >= PLACE_DWELL_MS) {
		state.actedZone = zone;
		const view = places[zone]?.view;
		if (view && now - state.manualAt >= MANUAL_GRACE_MS) out.push({ navigate: view, zone });
	}
	// lying down in a spot that turns the screen off, at night
	if (zone && presence.posture === 'lying' && places[zone]?.lieOff && quiet) {
		if (state.lyingSince == null) state.lyingSince = now;
		if (!state.lieActed && now - state.lyingSince >= LIE_OFF_MS) {
			state.lieActed = true;
			out.push({ panel: 'off', reason: 'asleep' });
		}
	} else {
		state.lyingSince = null;
		state.lieActed = false;
	}
	// nobody home
	if (!presence.count) {
		if (state.emptySince == null) state.emptySince = now;
		if (settings.awayMinutes && !state.awayActed && now - state.emptySince >= settings.awayMinutes * 60000) {
			state.awayActed = true;
			out.push({ panel: 'off', reason: 'away' });
		}
	} else {
		state.emptySince = null;
		state.awayActed = false;
	}
	return out;
}

/** "start taking notes" / "stop transcribing" said to the wall, or null. */
export function notesCommand(said) {
	const t = String(said || '')
		.toLowerCase()
		.replace(/[^a-z' ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (/^(?:please )?(?:start|begin|turn on|resume)(?: taking| the)? (?:notes|transcri\w*|dictation)\b/.test(t)) return 'start';
	if (/^(?:please )?(?:take notes|transcribe(?: this| everything)?|start writing)\b/.test(t)) return 'start';
	if (/^(?:please )?(?:stop|end|finish|turn off|pause)(?: taking| the)? (?:notes|transcri\w*|dictation)\b/.test(t)) return 'stop';
	return null;
}

/** How far past the "at the wall" distance you must step back before you count as gone. */
export const NEAR_MARGIN_M = 0.3;

/**
 * The wall's view of the room from one camera report: numbers only. `wasNear`
 * gives the line a margin, so standing right on it doesn't flick the screen
 * on and off.
 */
export function presenceFrom(camera, settings = DEFAULT_SENSES, online = true, wasNear = false) {
	const c = camera && typeof camera === 'object' ? camera : {};
	const ok = Boolean(online && c.ok);
	const count = ok ? Math.max(0, Math.min(20, Math.round(Number(c.count) || 0))) : 0;
	const distance = ok && count && Number.isFinite(Number(c.distance)) && c.distance != null ? Math.round(Number(c.distance) * 100) / 100 : null;
	const x = ok && count && Number.isFinite(Number(c.x)) && c.x != null ? Math.max(-1, Math.min(1, Number(c.x))) : null;
	const motion = ok ? Math.max(0, Math.min(1, Number(c.motion) || 0)) : 0;
	const zone = ok && count && typeof c.zone === 'string' ? c.zone.slice(0, 24) : null;
	const posture = ok && count && (c.posture === 'lying' || c.posture === 'upright') ? c.posture : null;
	// no metres (a whole-room camera before the floor is mapped): being in the room counts
	const near =
		distance != null
			? distance <= settings.nearMeters || (wasNear && distance <= settings.nearMeters + NEAR_MARGIN_M)
			: settings.look === 'body' && count > 0;
	return { camera: ok, count, distance, x, zone, posture, motion, near, calibrated: Boolean(c.calibrated) };
}

/** Worth telling every screen about? (Small wobbles aren't.) */
export function presenceChanged(a, b) {
	if (!a || !b) return true;
	if (a.camera !== b.camera || a.count !== b.count || a.near !== b.near) return true;
	if (a.zone !== b.zone || a.posture !== b.posture) return true;
	if ((a.distance == null) !== (b.distance == null)) return true;
	if (a.distance != null && Math.abs(a.distance - b.distance) >= 0.1) return true;
	if ((a.x == null) !== (b.x == null)) return true;
	if (a.x != null && Math.abs(a.x - b.x) >= 0.08) return true;
	return (a.motion > 0.02) !== (b.motion > 0.02);
}

/** How long to keep the ears shut while the wall says this (it must not hear itself). */
export function hushMsFor(said) {
	const chars = String(said || '').length;
	return Math.min(30000, 1500 + chars * 75);
}

/** "1.4 m", "60 cm", or '' for the phone's readout. */
export function describeDistance(m) {
	if (m == null || !Number.isFinite(Number(m))) return '';
	return m < 1 ? `${Math.round(m * 100)} cm` : `${(Math.round(m * 10) / 10).toFixed(1)} m`;
}

/** A transcript as a plain-text file: one line per thing said, with the time. */
export function transcriptText(lines, { timeZone, title = 'Notes from the wall' } = {}) {
	const fmt = (at) => {
		try {
			return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
		} catch {
			return new Date(at).toISOString().slice(11, 16);
		}
	};
	return [title, '', ...lines.map((l) => `[${fmt(l.at)}] ${l.text}`), ''].join('\n');
}
