/**
 * The wall's voice: ElevenLabs text to speech, cached on disk.
 *
 *   GET  /api/voice                 settings, whether a key is set, today's usage
 *   POST /api/voice                 change settings { enabled, voiceId, quietStart, quietEnd,
 *                                   dayVolume, nightVolume, nightSilent, dailyChars }
 *   POST /api/voice/say             { text, urgent?, source? } (or a text/plain body): say it on the wall
 *   GET  /api/voice/clip/<id>.mp3   a cached clip (the kiosk's <audio> fetches these)
 *
 * Same Bearer token as /api/tasks, except clips: their names are hashes of
 * what was said, and an <audio> element can't send a header.
 *
 * The key comes from ELEVENLABS_API_KEY or data/elevenlabs-key (gitignored).
 * A phone can write that file over /ws (setKey) but nothing ever reads the
 * key back out: answers carry only where it came from and its last four
 * characters. Without a key, or when ElevenLabs fails, or during
 * quiet hours, the wall still shows the words on the island; it just doesn't
 * speak them. A phrase is only paid for once: clips are kept by a hash of
 * voice, model and text, so "Pasta timer is done." is free the second time.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { wallDayKey } from '../calendarItems.js';
import { CLIP_NAME, inQuietHours, normalizeVoiceSettings, roomEmpty, roomVolume, speechText, voiceVolumeAt, welcomeBackText } from '../wallVoice.js';
import { authorized, loadApiToken } from './taskService.js';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const USER_API = 'https://api.elevenlabs.io/v1/user';
// ElevenLabs keys look like sk_ followed by hex; allow some slack for other shapes
const KEY_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;
const TTS_TIMEOUT_MS = 8000;
const MAX_CLIPS = 300;
const MAX_BODY = 4 * 1024;

export function clipKey(voiceId, model, text) {
	return createHash('sha256').update(`${voiceId}\u0000${model}\u0000${text}`).digest('hex').slice(0, 32);
}

export function loadElevenLabsKey(file, env = process.env) {
	const fromEnv = String(env.ELEVENLABS_API_KEY || '').trim();
	if (fromEnv) return fromEnv;
	try {
		if (existsSync(file)) return readFileSync(file, 'utf8').trim();
	} catch {
		/* unreadable: no key */
	}
	return '';
}

function readJson(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

function readBody(req) {
	const plain = /^text\/plain/i.test(req.headers?.['content-type'] ?? '');
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
				resolve(v && typeof v === 'object' ? v : { text: String(v) });
			} catch {
				if (plain) return resolve({ text: raw.trim() });
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

export function createVoiceHub({
	dataDir,
	broadcast = () => {},
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	env = process.env,
	log = console,
	// where you are, from the webcam (sensesHub presence), or null without one
	room = () => null
}) {
	const settingsFile = path.join(dataDir, 'voice.json');
	const usageFile = path.join(dataDir, 'voice-usage.json');
	const keyFile = path.join(dataDir, 'elevenlabs-key');
	const clipDir = path.join(dataDir, 'voice-cache');
	const tokenFile = path.join(dataDir, 'api-token');
	let settings = normalizeVoiceSettings(readJson(settingsFile, {}));
	let usage = readJson(usageFile, { day: '', chars: 0 });
	let seq = 0;
	// said to an empty room, kept to say when someone is back: [{ text, at }]
	let held = [];

	const key = () => loadElevenLabsKey(keyFile, env);

	function usedToday() {
		const day = wallDayKey(now());
		if (usage.day !== day) usage = { day, chars: 0 };
		return usage.chars;
	}

	function spend(chars) {
		usedToday();
		usage.chars += chars;
		try {
			writeFileSync(usageFile, JSON.stringify(usage));
		} catch {
			/* usage is advisory */
		}
	}

	function snapshot() {
		const k = key();
		const fromEnv = Boolean(String(env.ELEVENLABS_API_KEY || '').trim());
		return {
			...settings,
			hasKey: Boolean(k),
			// never the key: where it came from and its last four characters
			keySource: !k ? '' : fromEnv ? 'env' : 'file',
			keyHint: k ? `…${k.slice(-4)}` : '',
			charsToday: usedToday(),
			quietNow: inQuietHours(now(), settings),
			volumeNow: voiceVolumeAt(now(), settings),
			heldCount: held.length
		};
	}

	/** Ask ElevenLabs whether a key works. 'ok', 'invalid' or 'unknown'
	 *  (unreachable, or a restricted key that can't read the account). */
	async function checkKey(candidate) {
		try {
			const res = await fetchImpl(USER_API, {
				headers: { 'xi-api-key': candidate },
				signal: AbortSignal.timeout(TTS_TIMEOUT_MS)
			});
			if (res.ok) return 'ok';
			const body = await res.text().catch(() => '');
			if (res.status === 401 && /invalid_api_key|invalid api key/i.test(body)) return 'invalid';
			return 'unknown';
		} catch {
			return 'unknown';
		}
	}

	/**
	 * Save the key typed on the phone to data/elevenlabs-key (owner-only).
	 * It's checked with ElevenLabs first and refused only when ElevenLabs
	 * says it's not a key. The phone never gets it back.
	 */
	async function setKey(candidate) {
		const k = String(candidate ?? '').trim();
		if (!KEY_SHAPE.test(k)) return { ok: false, error: 'bad-format' };
		const check = await checkKey(k);
		if (check === 'invalid') return { ok: false, error: 'invalid' };
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(keyFile, `${k}\n`, { mode: 0o600 });
		try {
			chmodSync(keyFile, 0o600);
		} catch {
			/* best effort */
		}
		return { ok: true, verified: check === 'ok' };
	}

	function forgetKey() {
		try {
			if (existsSync(keyFile)) unlinkSync(keyFile);
		} catch {
			return { ok: false, error: 'unwritable' };
		}
		return { ok: true };
	}

	function setSettings(patch = {}) {
		settings = normalizeVoiceSettings({ ...settings, ...patch });
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
		return snapshot();
	}

	function prune() {
		try {
			const files = readdirSync(clipDir)
				.filter((f) => CLIP_NAME.test(f))
				.map((f) => ({ f, t: statSync(path.join(clipDir, f)).mtimeMs }))
				.sort((a, b) => b.t - a.t);
			for (const { f } of files.slice(MAX_CLIPS)) unlinkSync(path.join(clipDir, f));
		} catch {
			/* nothing to prune */
		}
	}

	/** An mp3 for the text, from the cache or ElevenLabs. { id } or { error }. */
	async function clip(text) {
		const id = clipKey(settings.voiceId, settings.model, text);
		const file = path.join(clipDir, `${id}.mp3`);
		if (existsSync(file)) return { id, cached: true };
		const apiKey = key();
		if (!apiKey) return { error: 'no-key' };
		if (usedToday() + text.length > settings.dailyChars) return { error: 'daily-limit' };
		try {
			const res = await fetchImpl(`${API}/${encodeURIComponent(settings.voiceId)}?output_format=mp3_44100_128`, {
				method: 'POST',
				headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
				body: JSON.stringify({ text, model_id: settings.model }),
				signal: AbortSignal.timeout(TTS_TIMEOUT_MS)
			});
			if (!res.ok) {
				// never log the key; the status and ElevenLabs' short reason are enough
				log.warn?.(`[voice] ElevenLabs answered ${res.status}`);
				return { error: res.status === 401 ? 'bad-key' : res.status === 429 ? 'rate-limited' : 'tts-failed' };
			}
			const buf = Buffer.from(await res.arrayBuffer());
			if (!buf.length) return { error: 'tts-failed' };
			mkdirSync(clipDir, { recursive: true });
			writeFileSync(file, buf);
			spend(text.length);
			prune();
			return { id, cached: false };
		} catch (err) {
			log.warn?.(`[voice] ElevenLabs unreachable: ${err?.name || 'error'}`);
			return { error: 'tts-failed' };
		}
	}

	/**
	 * Say something on the wall. The words show on the island (unless
	 * `caption` is false, when something else already shows them); the
	 * audio comes along when there's a key and the voice is on, at the day or
	 * night volume (only the voice gets quieter; nothing else on the wall
	 * changes). With nightSilent it says nothing at night unless urgent.
	 * A `reply` answers someone who just spoke to the wall, so it is never
	 * held for later: they're there, even if the camera can't see them.
	 * Returns what happened.
	 */
	async function say(text, { urgent = false, reply = false, source = 'Wall', caption = true } = {}) {
		const words = speechText(text);
		if (!words) return { ok: false, error: 'empty' };
		const id = `speak-${++seq}`;
		let reason = '';
		let clipId = null;
		const here = settings.followRoom || settings.holdWhenAway ? room() : null;
		const quiet = inQuietHours(now(), settings);
		const volume = settings.followRoom ? roomVolume(voiceVolumeAt(now(), settings), here, { quiet }) : voiceVolumeAt(now(), settings);
		if (!settings.enabled) reason = 'off';
		else if (!urgent && settings.nightSilent && quiet) reason = 'quiet-hours';
		else if (!urgent && !reply && settings.holdWhenAway && roomEmpty(here)) {
			// nobody to hear it: show it, and say it when someone comes back
			reason = 'away';
			held = [...held, { text: words, at: now() }].slice(-10);
		} else {
			const c = await clip(words);
			if (c.id) clipId = c.id;
			else reason = c.error;
		}
		broadcast({
			type: 'speak',
			id,
			text: words,
			source,
			url: clipId ? `/api/voice/clip/${clipId}.mp3` : null,
			caption,
			// how loud this clip plays (0 to 1): the day or night voice, for where you are
			volume,
			silent: reason || undefined
		});
		return { ok: true, text: words, spoken: Boolean(clipId), volume, ...(reason ? { silent: reason } : {}) };
	}

	/** Someone came back into the room: say what was held for them (the last 12 hours of it). */
	async function welcomeBack() {
		const fresh = held.filter((h) => now() - h.at < 12 * 3600000);
		held = [];
		const text = welcomeBackText(fresh);
		if (!text) return null;
		return say(text, { source: 'Wall' });
	}

	function json(res, data, status = 200) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	}

	async function handleHttp(req, res) {
		const url = new URL(req.url || '/', 'http://local');
		const p = url.pathname;
		if (!p.startsWith('/api/voice')) return false;

		if (req.method === 'GET' && p.startsWith('/api/voice/clip/')) {
			const name = p.slice('/api/voice/clip/'.length);
			const file = CLIP_NAME.test(name) ? path.join(clipDir, name) : null;
			if (!file || !existsSync(file)) {
				json(res, { error: 'not found' }, 404);
				return true;
			}
			res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
			createReadStream(file).pipe(res);
			return true;
		}

		if (!authorized(req.headers, loadApiToken(tokenFile, env))) {
			json(res, { error: 'unauthorized' }, 401);
			return true;
		}

		try {
			if (req.method === 'GET' && p === '/api/voice') {
				json(res, snapshot());
				return true;
			}
			if (req.method === 'POST' && p === '/api/voice') {
				json(res, setSettings(await readBody(req)));
				return true;
			}
			if (req.method === 'POST' && p === '/api/voice/say') {
				const body = await readBody(req);
				// who is talking, shown with the words: an assistant names itself, a Shortcut is the iPhone
				const named = typeof body.source === 'string' ? body.source.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) : '';
				const out = await say(body.text, { urgent: body.urgent === true, source: named || 'iPhone' });
				const textMode = url.searchParams.get('format') === 'text' || /text\/plain/i.test(req.headers?.accept ?? '');
				if (textMode) {
					res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
					res.end(out.ok ? (out.spoken ? 'Said on the wall.' : 'Shown on the wall.') : 'Nothing to say.');
					return true;
				}
				json(res, out, out.ok ? 200 : 400);
				return true;
			}
		} catch (err) {
			json(res, { error: err.message }, err.status || 500);
			return true;
		}
		json(res, { error: 'not found' }, 404);
		return true;
	}

	// `key` is for the sound hub on the same kiosk; it is never sent to a phone
	return { say, welcomeBack, snapshot, setSettings, setKey, forgetKey, handleHttp, clip, key };
}
