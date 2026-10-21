import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bearer, createVoiceBox, speechRequest, wavToPcm } from '../src/lib/server/voiceBox.js';
import { createVoiceHub } from '../src/lib/server/voiceHub.js';
import { normalizeVoiceSettings } from '../src/lib/wallVoice.js';

const WAV = Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00', 'latin1'), Buffer.alloc(16), Buffer.from('data\x04\x00\x00\x00', 'latin1'), Buffer.from([1, 2, 3, 4])]);

/** The webcam process's voice box, faked: what it was asked, and what it answers. */
function fakeBox({ up = true, tts = true, stt = true, text = 'What time is it?' } = {}) {
	const asked = [];
	const fetchImpl = async (url, init = {}) => {
		if (!up) throw new Error('ECONNREFUSED');
		const p = new URL(url).pathname;
		asked.push({ path: p, body: init.body });
		const ok = (body, headers = {}) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body, headers: new Headers(headers) });
		if (p === '/health') return ok({ stt, tts, model: tts ? 'phonon-31m-en' : '', voices: tts ? [{ name: 'Easton', description: 'Punchy' }, { name: 'Harper', description: 'Friendly' }] : [] });
		if (p === '/speech') return tts ? ok(WAV.buffer.slice(WAV.byteOffset, WAV.byteOffset + WAV.length), { 'x-duration-ms': '1500' }) : { ok: false, status: 503, json: async () => ({ error: 'no-voice' }) };
		if (p === '/transcribe') {
			const bytes = Buffer.from(init.body);
			if (bytes.toString('latin1', 0, 4) !== 'RIFF') return { ok: false, status: 415, json: async () => ({ error: 'bad-audio' }) };
			return ok({ text });
		}
		throw new Error('unexpected ' + p);
	};
	return { asked, fetchImpl };
}

async function serve(opts = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'voicebox-'));
	if (opts.token) writeFileSync(path.join(dataDir, 'api-token'), opts.token);
	const fake = fakeBox(opts.box);
	const box = createVoiceBox({
		dataDir,
		env: {},
		fetchImpl: fake.fetchImpl,
		isLocal: () => Boolean(opts.local),
		device: (t) => (t === 'phone-token' ? { id: 'p1', name: 'Phone' } : null),
		defaultVoice: () => 'Easton',
		encode: async (wav, format) => (opts.ffmpeg ? Buffer.from(`${format}:${wav.length}`) : null)
	});
	const server = createServer(async (req, res) => {
		if (!(await box.handleHttp(req, res))) {
			res.writeHead(418);
			res.end();
		}
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	return { box, fake, base, close: () => new Promise((r) => server.close(r)) };
}

test('speechRequest: OpenAI body in, text and a safe voice out', () => {
	assert.deepEqual(speechRequest({ input: '  Hi   there ', voice: 'Harper', response_format: 'mp3' }), { text: 'Hi there', voice: 'Harper', format: 'mp3' });
	assert.equal(speechRequest({ input: 'x', voice: '../../etc' }).voice, '');
	assert.equal(speechRequest({ input: '' }).error, 'no-input');
	assert.equal(speechRequest({ input: 'x', response_format: 'midi' }).error, 'bad-format');
	assert.equal(speechRequest({ input: 'x'.repeat(5000) }).text.length, 1000);
});

test('bearer and wavToPcm', () => {
	assert.equal(bearer({ authorization: 'Bearer  abc ' }), 'abc');
	assert.equal(bearer({}), '');
	assert.deepEqual([...wavToPcm(WAV)], [1, 2, 3, 4]);
});

test('who may: the kiosk, a paired device, or the API token', async () => {
	const s = await serve({ token: 'api-secret' });
	try {
		assert.equal((await fetch(`${s.base}/v1/models`)).status, 401);
		assert.equal((await fetch(`${s.base}/v1/models`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
		assert.equal((await fetch(`${s.base}/v1/models`, { headers: { Authorization: 'Bearer api-secret' } })).status, 200);
		assert.equal((await fetch(`${s.base}/v1/models`, { headers: { Authorization: 'Bearer phone-token' } })).status, 200);
		const err = await (await fetch(`${s.base}/v1/audio/voices`)).json();
		assert.equal(err.error.type, 'unauthorized');
		// not ours: left for the rest of the server
		assert.equal((await fetch(`${s.base}/api/voice`)).status, 418);
	} finally {
		await s.close();
	}
	const local = await serve({ token: 'api-secret', local: true });
	try {
		assert.equal((await fetch(`${local.base}/v1/models`)).status, 200);
		// a proxy on this machine (tailscale serve) isn't this machine
		assert.equal((await fetch(`${local.base}/v1/models`, { headers: { 'X-Forwarded-For': '100.64.0.7' } })).status, 401);
	} finally {
		await local.close();
	}
});

test('models, voices and the phone status', async () => {
	const s = await serve();
	try {
		const models = await (await fetch(`${s.base}/v1/models`)).json();
		assert.deepEqual(models.data.map((m) => m.id), ['parakeet-tdt-0.6b-v2', 'phonon-31m-en']);
		const voices = await (await fetch(`${s.base}/v1/audio/voices`)).json();
		assert.deepEqual(voices.voices.map((v) => v.name), ['Easton', 'Harper']);
		const st = await (await fetch(`${s.base}/api/voice/box`)).json();
		assert.equal(st.up && st.stt && st.tts, true);
	} finally {
		await s.close();
	}
});

test('speech: a WAV by default, PCM when asked, mp3 through ffmpeg or a WAV without it', async () => {
	const s = await serve();
	try {
		const res = await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: JSON.stringify({ model: 'tts-1', input: 'Hello there.', voice: 'Harper' }) });
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('content-type'), 'audio/wav');
		assert.equal(res.headers.get('x-duration-ms'), '1500');
		assert.equal(Buffer.from(await res.arrayBuffer()).toString('latin1', 0, 4), 'RIFF');
		assert.deepEqual(JSON.parse(s.fake.asked.find((a) => a.path === '/speech').body), { text: 'Hello there.', voice: 'Harper' });
		const pcm = await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: JSON.stringify({ input: 'Hi', response_format: 'pcm' }) });
		assert.deepEqual([...Buffer.from(await pcm.arrayBuffer())], [1, 2, 3, 4]);
		// OpenAI voice names aren't Phonon's: the wall's own voice speaks
		await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: JSON.stringify({ input: 'Hi', voice: 'alloy' }) });
		assert.equal(JSON.parse(s.fake.asked.filter((a) => a.path === '/speech').at(-1).body).voice, 'Easton');
		await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: JSON.stringify({ input: 'Hi', voice: 'harper' }) });
		assert.equal(JSON.parse(s.fake.asked.filter((a) => a.path === '/speech').at(-1).body).voice, 'Harper');
		const mp3 = await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: JSON.stringify({ input: 'Hi', response_format: 'mp3' }) });
		assert.equal(mp3.headers.get('content-type'), 'audio/wav');
		assert.equal((await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: '{}' })).status, 400);
		assert.equal((await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: 'not json' })).status, 400);
	} finally {
		await s.close();
	}
	const enc = await serve({ ffmpeg: true });
	try {
		const mp3 = await fetch(`${enc.base}/v1/audio/speech`, { method: 'POST', body: JSON.stringify({ input: 'Hi', response_format: 'mp3' }) });
		assert.equal(mp3.headers.get('content-type'), 'audio/mpeg');
		assert.equal(await mp3.text(), `mp3:${WAV.length}`);
	} finally {
		await enc.close();
	}
});

test('speech: without Phonon or with the box down, a clear 503', async () => {
	for (const box of [{ tts: false }, { up: false }]) {
		const s = await serve({ box, local: true });
		try {
			const res = await fetch(`${s.base}/v1/audio/speech`, { method: 'POST', body: JSON.stringify({ input: 'Hi' }) });
			assert.equal(res.status, 503);
			assert.match((await res.json()).error.message, /Phonon|voice/);
		} finally {
			await s.close();
		}
	}
});

test('transcriptions: multipart like OpenAI, a raw body, and text or json back', async () => {
	const s = await serve();
	try {
		const form = new FormData();
		form.append('file', new Blob([WAV], { type: 'audio/wav' }), 'clip.wav');
		form.append('model', 'whisper-1');
		const res = await fetch(`${s.base}/v1/audio/transcriptions`, { method: 'POST', body: form });
		assert.deepEqual(await res.json(), { text: 'What time is it?' });
		const raw = await fetch(`${s.base}/v1/audio/transcriptions?response_format=text`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: WAV });
		assert.equal(await raw.text(), 'What time is it?');
		const asText = new FormData();
		asText.append('file', new Blob([WAV]), 'clip.wav');
		asText.append('response_format', 'text');
		assert.equal(await (await fetch(`${s.base}/v1/audio/transcriptions`, { method: 'POST', body: asText })).text(), 'What time is it?');
		const bad = await fetch(`${s.base}/v1/audio/transcriptions`, { method: 'POST', body: Buffer.from('not audio') });
		assert.equal(bad.status, 400);
		assert.equal((await bad.json()).error.code, 'bad-audio');
		const none = new FormData();
		none.append('model', 'whisper-1');
		assert.equal((await fetch(`${s.base}/v1/audio/transcriptions`, { method: 'POST', body: none })).status, 400);
	} finally {
		await s.close();
	}
});

/* ---------- the wall's own voice speaking with Phonon ---------- */

function voiceHub({ settings, box, piperVoices = [], key = '' } = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'voice-phonon-'));
	if (settings) writeFileSync(path.join(dataDir, 'voice.json'), JSON.stringify(settings));
	const sent = [];
	const piper = {
		voices: () => piperVoices.map((name) => ({ name, label: name })),
		speak: async (text, file) => {
			writeFileSync(file, 'RIFFpiper');
			return { ok: true };
		}
	};
	const eleven = async () => ({ ok: false, status: 500, text: async () => '' });
	const h = createVoiceHub({ dataDir, broadcast: (m) => sent.push(m), env: key ? { ELEVENLABS_API_KEY: key } : {}, fetchImpl: eleven, log: { warn() {} }, piper, box });
	return { h, sent, dataDir };
}

function phonon({ tts = true } = {}) {
	const said = [];
	return {
		said,
		status: () => ({ up: true, tts, stt: true, voices: tts ? [{ name: 'Easton' }, { name: 'Harper' }] : [] }),
		speak: async (text, voice) => {
			said.push({ text, voice });
			return tts ? { ok: true, audio: Buffer.from('RIFFphonon'), durationMs: 2100 } : { ok: false, error: 'no-voice' };
		}
	};
}

test('auto with no ElevenLabs key speaks with Phonon before Piper, once per sentence', async () => {
	const box = phonon();
	const { h, sent, dataDir } = voiceHub({ box, piperVoices: ['en_US-lessac-medium'], settings: { phononVoice: 'Harper' } });
	assert.equal(h.snapshot().speaking, 'phonon');
	assert.deepEqual(h.snapshot().phononVoices.map((v) => v.name), ['Easton', 'Harper']);
	await h.say('Pasta timer is done.');
	await h.say('Pasta timer is done.');
	assert.deepEqual(box.said, [{ text: 'Pasta timer is done.', voice: 'Harper' }]);
	const speak = sent.filter((m) => m.type === 'speak');
	assert.match(speak[0].url, /\.wav$/);
	assert.equal(speak[0].durationMs, 2100);
	assert.equal(readdirSync(path.join(dataDir, 'voice-cache')).length, 1);
});

test('Phonon failing or missing falls to Piper; engine: phonon never pays ElevenLabs', async () => {
	const down = voiceHub({ box: phonon({ tts: false }), piperVoices: ['en_US-lessac-medium'], settings: { engine: 'phonon' } });
	assert.equal(down.h.snapshot().speaking, 'piper');
	const out = await down.h.say('Hello.');
	assert.equal(out.spoken, true);
	const broken = phonon();
	broken.speak = async () => ({ ok: false, error: 'tts-failed' });
	const fallback = voiceHub({ box: broken, piperVoices: ['en_US-lessac-medium'], settings: { engine: 'phonon' }, key: 'sk_test' });
	assert.equal((await fallback.h.say('Hello again.')).spoken, true);
	const none = voiceHub({ box: phonon({ tts: false }), settings: { engine: 'phonon' } });
	assert.equal(none.h.snapshot().speaking, '');
});

test('voice settings keep phonon and a well-formed Phonon voice', () => {
	assert.equal(normalizeVoiceSettings({ engine: 'phonon' }).engine, 'phonon');
	assert.equal(normalizeVoiceSettings({ phononVoice: 'Juniper' }).phononVoice, 'Juniper');
	assert.equal(normalizeVoiceSettings({ phononVoice: '<b>x</b>' }).phononVoice, 'Easton');
});
