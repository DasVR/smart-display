/**
 * The wall's ears and voice, lent to anything that asks: phones and
 * computers (the remote's voice sheet), Hermes, and any app that speaks
 * OpenAI's audio API. The work is done by the voice box in the webcam
 * process (senses/wall_senses/voicebox.py, on 127.0.0.1:3011): Parakeet
 * listens, Phonon speaks. This side checks who is asking and translates.
 *
 *   GET  /v1/models                    what's here, OpenAI-style
 *   GET  /v1/audio/voices              Phonon's voices: [{ name, description }]
 *   POST /v1/audio/speech              { input, voice?, response_format? } -> audio
 *   POST /v1/audio/transcriptions      multipart `file` (or a raw audio body) -> { text }
 *   GET  /api/voice/box                { up, stt, tts, model, voices } for the phone
 *
 * Who may: the kiosk itself, a paired phone or computer (its device token as
 * the Bearer), or the /api token (data/api-token) for Hermes and scripts.
 * With no /api token set, the same as /api/tasks: anyone on the network.
 * docs/voice-server.md has the setup.
 */
import { spawn } from 'node:child_process';
import { authorized, loadApiToken } from './taskService.js';

const DEFAULT_URL = 'http://127.0.0.1:3011';
const HEALTH_MS = 15000;
const MAX_AUDIO = 25 * 1024 * 1024;
const MAX_TEXT = 1000;
const TIMEOUT_MS = 30000;
const TYPES = { mp3: 'audio/mpeg', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', pcm: 'audio/L16' };

/** OpenAI's speech request -> what the voice box needs. { text, voice, format } or { error }. */
export function speechRequest(body = {}) {
	const text = String(body.input ?? body.text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_TEXT);
	if (!text) return { error: 'no-input' };
	const format = String(body.response_format || 'wav').toLowerCase();
	if (!TYPES[format]) return { error: 'bad-format' };
	// OpenAI's own voice names (alloy, nova…) aren't Phonon's: those get the wall's voice
	const voice = typeof body.voice === 'string' && /^[A-Za-z][A-Za-z ._-]{0,30}$/.test(body.voice) ? body.voice : '';
	return { text, voice, format };
}

/** The Bearer token a request carries, or ''. */
export function bearer(headers = {}) {
	const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization || ''));
	return m ? m[1].trim() : '';
}

/** A WAV's 16-bit samples as raw little-endian PCM (OpenAI's `pcm` format). */
export function wavToPcm(buf) {
	if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return buf;
	let at = 12;
	while (at + 8 <= buf.length) {
		const id = buf.toString('ascii', at, at + 4);
		const size = buf.readUInt32LE(at + 4);
		if (id === 'data') return buf.subarray(at + 8, at + 8 + size);
		at += 8 + size + (size % 2);
	}
	return buf;
}

function readRaw(req, limit = MAX_AUDIO) {
	return new Promise((resolve, reject) => {
		const parts = [];
		let size = 0;
		req.on('data', (c) => {
			size += c.length;
			if (size > limit) {
				reject(Object.assign(new Error('too large'), { status: 413 }));
				req.destroy();
				return;
			}
			parts.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(parts)));
		req.on('error', reject);
	});
}

/** The audio in a transcription request: the multipart `file`, or the body itself. */
export async function audioFrom(headers, raw) {
	const type = String(headers['content-type'] || '');
	if (!/^multipart\/form-data/i.test(type)) return { audio: raw, fields: {} };
	const form = await new Request('http://local/', { method: 'POST', headers: { 'content-type': type }, body: raw }).formData();
	const file = form.get('file');
	const fields = {};
	for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
	if (!file || typeof file === 'string') return { error: 'no-file', fields };
	return { audio: Buffer.from(await file.arrayBuffer()), fields };
}

/** WAV -> another format with ffmpeg, when it's installed. Resolves null when it can't. */
function transcode(wav, format) {
	const codec = { mp3: ['-f', 'mp3', '-b:a', '96k'], opus: ['-f', 'ogg', '-c:a', 'libopus', '-b:a', '48k'], aac: ['-f', 'adts', '-b:a', '96k'], flac: ['-f', 'flac'] }[format];
	if (!codec) return Promise.resolve(null);
	return new Promise((resolve) => {
		let p;
		try {
			p = spawn('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', ...codec, 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
		} catch {
			return resolve(null);
		}
		const out = [];
		p.on('error', () => resolve(null));
		p.stdout.on('data', (c) => out.push(c));
		p.on('close', (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
		p.stdin.on('error', () => {});
		p.stdin.end(wav);
	});
}

export function createVoiceBox({
	dataDir,
	url = process.env.WALL_VOICEBOX_URL || DEFAULT_URL,
	fetchImpl = globalThis.fetch,
	env = process.env,
	isLocal = () => false,
	device = () => null,
	now = () => Date.now(),
	encode = transcode,
	// the voice the wall itself speaks in, for callers that don't name one of Phonon's
	defaultVoice = () => '',
	log = console
}) {
	const tokenFile = dataDir ? `${dataDir}/api-token` : '';
	let health = { up: false, stt: false, tts: false, model: '', voices: [] };
	let checkedAt = 0;
	let checking = null;

	async function refresh() {
		if (checking) return checking;
		checking = (async () => {
			try {
				const res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(3000) });
				const h = res.ok ? await res.json() : null;
				health = h ? { up: true, stt: Boolean(h.stt), tts: Boolean(h.tts), model: String(h.model || ''), voices: Array.isArray(h.voices) ? h.voices : [] } : { ...health, up: false };
			} catch {
				health = { up: false, stt: false, tts: false, model: '', voices: [] };
			}
			checkedAt = now();
			return health;
		})();
		try {
			return await checking;
		} finally {
			checking = null;
		}
	}

	/** What the voice box can do, from the last check (refreshed in the background). */
	function status() {
		if (now() - checkedAt > HEALTH_MS) refresh().catch(() => {});
		return health;
	}

	/** Phonon's name for `voice` ("harper" -> "Harper"), else the wall's own voice. */
	function voiceFor(voice) {
		const names = health.voices.map((v) => v.name);
		const want = String(voice || '').toLowerCase();
		return names.find((n) => n.toLowerCase() === want) || defaultVoice() || '';
	}

	/** Speak with Phonon: { ok, audio (WAV), durationMs } or { ok: false, error }. */
	async function speak(text, voice = '') {
		try {
			const res = await fetchImpl(`${url}/speech`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, voice }),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				if (res.status === 503) health = { ...health, tts: false };
				return { ok: false, error: err.error === 'no-voice' || err.error === 'not-installed' ? 'no-voice' : 'tts-failed' };
			}
			const audio = Buffer.from(await res.arrayBuffer());
			return audio.length ? { ok: true, audio, durationMs: Number(res.headers.get('x-duration-ms')) || 0 } : { ok: false, error: 'tts-failed' };
		} catch {
			health = { ...health, up: false };
			return { ok: false, error: 'box-down' };
		}
	}

	/** Words from audio: { ok, text } or { ok: false, error }. */
	async function transcribe(audio) {
		try {
			const res = await fetchImpl(`${url}/transcribe`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: audio,
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) return { ok: false, error: out.error === 'bad-audio' ? 'bad-audio' : res.status === 503 ? 'no-ears' : 'stt-failed' };
			return { ok: true, text: String(out.text || '').trim() };
		} catch {
			health = { ...health, up: false };
			return { ok: false, error: 'box-down' };
		}
	}

	function allowed(req) {
		// this machine itself, but not a proxy on it (tailscale serve forwards the tailnet from 127.0.0.1)
		if (isLocal(req) && !req.headers['x-forwarded-for']) return true;
		const t = bearer(req.headers);
		if (t && device(t)) return true;
		return authorized(req.headers, loadApiToken(tokenFile, env));
	}

	const json = (res, body, status = 200) => {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(body));
	};
	// OpenAI clients read errors as { error: { message, type } }
	const fail = (res, status, code, message) => json(res, { error: { message, type: code, code } }, status);

	async function handleHttp(req, res) {
		const p = new URL(req.url || '/', 'http://local').pathname;
		const ours = p === '/api/voice/box' || p === '/v1/models' || p.startsWith('/v1/audio/');
		if (!ours) return false;
		if (!allowed(req)) {
			fail(res, 401, 'unauthorized', 'Pair this device with the wall, or send the wall’s API token as the Bearer.');
			return true;
		}
		try {
			if (req.method === 'GET' && p === '/api/voice/box') {
				json(res, await refresh());
				return true;
			}
			if (req.method === 'GET' && p === '/v1/models') {
				const h = await refresh();
				const data = [h.stt && 'parakeet-tdt-0.6b-v2', h.tts && (h.model || 'phonon')].filter(Boolean).map((id) => ({ id, object: 'model', owned_by: 'wall' }));
				json(res, { object: 'list', data });
				return true;
			}
			if (req.method === 'GET' && p === '/v1/audio/voices') {
				json(res, { voices: (await refresh()).voices });
				return true;
			}
			if (req.method === 'POST' && p === '/v1/audio/speech') {
				const raw = await readRaw(req, 64 * 1024);
				let body = {};
				try {
					body = JSON.parse(raw.toString('utf8') || '{}');
				} catch {
					fail(res, 400, 'invalid_request_error', 'The body should be JSON: { "input": "…" }.');
					return true;
				}
				const ask = speechRequest(body);
				if (ask.error) {
					fail(res, 400, 'invalid_request_error', ask.error === 'no-input' ? 'Nothing to say: send "input".' : 'response_format is one of mp3, opus, aac, flac, wav, pcm.');
					return true;
				}
				if (!checkedAt) await refresh();
				const out = await speak(ask.text, voiceFor(ask.voice));
				if (!out.ok) {
					fail(res, 503, out.error, out.error === 'no-voice' ? 'Phonon is not installed on the wall (scripts/senses/install.sh).' : 'The wall’s voice isn’t answering.');
					return true;
				}
				let audio = out.audio;
				let type = 'audio/wav';
				if (ask.format === 'pcm') {
					audio = wavToPcm(audio);
					type = 'audio/L16; rate=24000; channels=1';
				} else if (ask.format !== 'wav') {
					// without ffmpeg it stays a WAV, which every player reads anyway
					const encoded = await encode(audio, ask.format);
					if (encoded) {
						audio = encoded;
						type = TYPES[ask.format];
					}
				}
				res.writeHead(200, { 'Content-Type': type, 'Content-Length': audio.length, ...(out.durationMs ? { 'X-Duration-Ms': String(out.durationMs) } : {}) });
				res.end(audio);
				return true;
			}
			if (req.method === 'POST' && p === '/v1/audio/transcriptions') {
				const got = await audioFrom(req.headers, await readRaw(req));
				if (got.error || !got.audio?.length) {
					fail(res, 400, 'invalid_request_error', 'Send the recording as the "file" field (or as the body).');
					return true;
				}
				const out = await transcribe(got.audio);
				if (!out.ok) {
					const msg = { 'bad-audio': 'The wall couldn’t read that audio. Send a WAV, or install ffmpeg on the wall.', 'no-ears': 'Parakeet is not installed on the wall.' }[out.error];
					fail(res, out.error === 'bad-audio' ? 400 : 503, out.error, msg || 'The wall’s ears aren’t answering.');
					return true;
				}
				const format = String(got.fields.response_format || new URL(req.url, 'http://local').searchParams.get('response_format') || 'json');
				if (format === 'text') {
					res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
					res.end(out.text);
				} else json(res, format === 'verbose_json' ? { text: out.text, language: 'en', task: 'transcribe' } : { text: out.text });
				return true;
			}
		} catch (err) {
			fail(res, err.status || 500, 'server_error', err.status === 413 ? 'That recording is too long.' : 'Something went wrong on the wall.');
			return true;
		}
		fail(res, 404, 'not_found', 'Not here.');
		return true;
	}

	return { status, refresh, speak, transcribe, handleHttp, allowed, voiceFor };
}
