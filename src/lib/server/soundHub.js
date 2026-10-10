/**
 * Sounds made from the phone: ElevenLabs sound effects, kept on the kiosk.
 *
 *   GET    /api/sounds/custom              the list { sounds, assign, ... } (the kiosk's player reads this)
 *   GET    /api/sounds/custom/<name>.mp3   one clip
 *   POST   /api/sounds/generate            { idea, seconds? } a new sound, or { kind } the library's
 *                                          own prompt for a kind (a stand-in becomes a real sound)
 *   POST   /api/sounds/assign              { kind, name } play this sound for that event; name null undoes it
 *   DELETE /api/sounds/custom/<name>       forget a sound
 *
 * Writes need the same Bearer token as /api/tasks; the list and the clips
 * don't, since the kiosk's player can't send a header (and a clip is only a
 * sound). The phone page does the same over /ws ({ type: 'sounds', op }).
 *
 * Each clip is made once and kept in data/sounds/, with data/sounds/custom.json
 * saying what it is and which events use it. The key is the voice's ElevenLabs
 * key (voiceHub), read here and never returned. Making sounds costs credits,
 * so there's a cap on how many exist and on seconds made per day.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { wallDayKey } from '../calendarItems.js';
import { SOUND_NAMES } from '../sounds/library.js';
import { DAILY_SECONDS, DEFAULT_GAIN, MAX_CUSTOM, NAME_RE, buildSoundPrompt, clampSeconds, guessSeconds, libraryRequest, soundName } from '../sounds/custom.js';
import { authorized, loadApiToken } from './taskService.js';

const API = 'https://api.elevenlabs.io/v1/sound-generation';
const GENERATE_TIMEOUT_MS = 60000;
const MAX_BODY = 4 * 1024;
const MIN_BYTES = 200; // anything smaller is an error page, not audio

function readJson(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (c) => {
			raw += c;
			if (raw.length > MAX_BODY) {
				reject(Object.assign(new Error('body too large'), { status: 413 }));
				req.destroy();
			}
		});
		req.on('end', () => {
			if (!raw.trim()) return resolve({});
			try {
				const v = JSON.parse(raw);
				resolve(v && typeof v === 'object' ? v : {});
			} catch {
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

export function createSoundHub({
	dataDir,
	getKey = () => '',
	broadcast = () => {},
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	env = process.env,
	log = console,
	dailySeconds = DAILY_SECONDS
}) {
	const dir = path.join(dataDir, 'sounds');
	const manifestFile = path.join(dir, 'custom.json');
	const usageFile = path.join(dataDir, 'sounds-usage.json');
	const tokenFile = path.join(dataDir, 'api-token');
	let usage = readJson(usageFile, { day: '', seconds: 0 });
	let chain = Promise.resolve();

	function load() {
		const raw = readJson(manifestFile, {});
		const sounds = {};
		for (const [name, s] of Object.entries(raw.sounds || {})) {
			if (NAME_RE.test(name) && existsSync(path.join(dir, `${name}.mp3`))) {
				sounds[name] = {
					idea: String(s.idea || name).slice(0, 140),
					prompt: String(s.prompt || '').slice(0, 400),
					seconds: clampSeconds(s.seconds),
					gain: Math.min(1, Math.max(0, Number(s.gain) || DEFAULT_GAIN)),
					kind: SOUND_NAMES.includes(s.kind) ? s.kind : undefined,
					made: Number(s.made) || 0
				};
			}
		}
		const assign = {};
		for (const [kind, name] of Object.entries(raw.assign || {})) if (SOUND_NAMES.includes(kind) && sounds[name]) assign[kind] = name;
		return { sounds, assign };
	}

	function save(state) {
		mkdirSync(dir, { recursive: true });
		const tmp = `${manifestFile}.tmp`;
		writeFileSync(tmp, JSON.stringify(state, null, 2));
		renameSync(tmp, manifestFile);
	}

	function secondsToday() {
		const day = wallDayKey(now());
		if (usage.day !== day) usage = { day, seconds: 0 };
		return usage.seconds;
	}

	function spend(seconds) {
		secondsToday();
		usage.seconds = Math.round((usage.seconds + seconds) * 10) / 10;
		try {
			writeFileSync(usageFile, JSON.stringify(usage));
		} catch {
			/* usage is advisory */
		}
	}

	/** Everything the phone and the kiosk's player need. Never the key. */
	function snapshot() {
		const { sounds, assign } = load();
		return { sounds, assign, max: MAX_CUSTOM, secondsToday: secondsToday(), dailySeconds, hasKey: Boolean(getKey()) };
	}

	async function synth(request, key) {
		try {
			const res = await fetchImpl(API, {
				method: 'POST',
				headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
				body: JSON.stringify({ text: request.prompt, duration_seconds: request.seconds, prompt_influence: request.influence ?? 0.7 }),
				signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS)
			});
			if (!res.ok) {
				log.warn?.(`[sounds] ElevenLabs answered ${res.status}`);
				return { error: res.status === 401 ? 'bad-key' : res.status === 429 ? 'rate-limited' : 'failed' };
			}
			const buf = Buffer.from(await res.arrayBuffer());
			return buf.length >= MIN_BYTES ? { buf } : { error: 'failed' };
		} catch (err) {
			log.warn?.(`[sounds] ElevenLabs unreachable: ${err?.name || 'error'}`);
			return { error: 'failed' };
		}
	}

	async function generateNow(input = {}) {
		const key = getKey();
		if (!key) return { ok: false, error: 'no-key' };
		const state = load();

		let request;
		if (input.kind !== undefined && input.kind !== null && input.kind !== '') {
			request = libraryRequest(String(input.kind));
			if (!request) return { ok: false, error: 'unknown-kind' };
			request.name = `lib-${request.kind}`;
		} else {
			const built = buildSoundPrompt(input.idea);
			if (!built.idea) return { ok: false, error: 'empty' };
			request = {
				idea: built.idea,
				prompt: built.prompt,
				seconds: clampSeconds(input.seconds, guessSeconds(built.idea)),
				influence: 0.7,
				gain: DEFAULT_GAIN,
				name: soundName(built.idea, Object.keys(state.sounds))
			};
			if (Object.keys(state.sounds).length >= MAX_CUSTOM) return { ok: false, error: 'too-many' };
		}

		if (secondsToday() + request.seconds > dailySeconds) return { ok: false, error: 'daily-limit' };
		const made = await synth(request, key);
		if (made.error) return { ok: false, error: made.error };

		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, `${request.name}.mp3`), made.buf);
		spend(request.seconds);
		state.sounds[request.name] = {
			idea: request.idea,
			prompt: request.prompt,
			seconds: request.seconds,
			gain: request.gain,
			...(request.kind ? { kind: request.kind } : {}),
			made: now()
		};
		// a library sound made from the phone takes over its own event straight away
		if (request.kind) state.assign[request.kind] = request.name;
		save(state);
		broadcast({ type: 'sounds-changed' });
		return { ok: true, name: request.name, sound: state.sounds[request.name], ...(request.kind ? { assigned: request.kind } : {}) };
	}

	/** One at a time: two taps must not race the cap, the budget or the manifest. */
	function generate(input) {
		const run = chain.then(() => generateNow(input));
		chain = run.catch(() => {});
		return run;
	}

	function assign(kind, name) {
		if (!SOUND_NAMES.includes(kind)) return { ok: false, error: 'unknown-kind' };
		const state = load();
		if (name === null || name === undefined || name === '') delete state.assign[kind];
		else if (!state.sounds[name]) return { ok: false, error: 'not-found' };
		else state.assign[kind] = name;
		save(state);
		broadcast({ type: 'sounds-changed' });
		return { ok: true, assign: state.assign };
	}

	function remove(name) {
		const state = load();
		if (!NAME_RE.test(String(name)) || !state.sounds[name]) return { ok: false, error: 'not-found' };
		delete state.sounds[name];
		for (const kind of Object.keys(state.assign)) if (state.assign[kind] === name) delete state.assign[kind];
		try {
			unlinkSync(path.join(dir, `${name}.mp3`));
		} catch {
			/* already gone */
		}
		save(state);
		broadcast({ type: 'sounds-changed' });
		return { ok: true };
	}

	function json(res, data, status = 200) {
		res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
		res.end(JSON.stringify(data));
	}

	const STATUS = { 'no-key': 400, empty: 400, 'unknown-kind': 400, 'not-found': 404, 'too-many': 409, 'daily-limit': 429, 'rate-limited': 429, 'bad-key': 502, failed: 502 };

	async function handleHttp(req, res) {
		const url = new URL(req.url || '/', 'http://local');
		const p = url.pathname;
		if (!p.startsWith('/api/sounds')) return false;

		if (req.method === 'GET' && p === '/api/sounds/custom') {
			json(res, snapshot());
			return true;
		}
		if (req.method === 'GET' && p.startsWith('/api/sounds/custom/')) {
			const m = /^([a-z0-9][a-z0-9-]{0,31})\.mp3$/.exec(p.slice('/api/sounds/custom/'.length));
			const file = m ? path.join(dir, `${m[1]}.mp3`) : null;
			if (!file || !existsSync(file)) {
				json(res, { error: 'not found' }, 404);
				return true;
			}
			// the name stays the same when a sound is made again, so don't cache for a year
			res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' });
			createReadStream(file).pipe(res);
			return true;
		}

		if (!authorized(req.headers, loadApiToken(tokenFile, env))) {
			json(res, { error: 'unauthorized' }, 401);
			return true;
		}
		try {
			let out;
			if (req.method === 'POST' && p === '/api/sounds/generate') out = await generate(await readBody(req));
			else if (req.method === 'POST' && p === '/api/sounds/assign') {
				const body = await readBody(req);
				out = assign(String(body.kind ?? ''), body.name ?? null);
			} else if (req.method === 'DELETE' && p.startsWith('/api/sounds/custom/')) out = remove(p.slice('/api/sounds/custom/'.length).replace(/\.mp3$/, ''));
			else {
				json(res, { error: 'not found' }, 404);
				return true;
			}
			json(res, out, out.ok ? 200 : STATUS[out.error] || 400);
		} catch (err) {
			json(res, { error: err.message }, err.status || 500);
		}
		return true;
	}

	return { snapshot, generate, assign, remove, handleHttp };
}
