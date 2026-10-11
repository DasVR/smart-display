import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NO_BELLS } from '../src/lib/sounds/library.js';
import { ROOM, buildSoundPrompt, cleanIdea, clampSeconds, guessSeconds, libraryRequest, soundName } from '../src/lib/sounds/custom.js';
import { createSoundHub } from '../src/lib/server/soundHub.js';

const quiet = { log() {}, warn() {}, error() {} };
const AUDIO = Buffer.alloc(600, 7);

/** A stand-in for ElevenLabs: records what it was asked and answers with audio. */
function fakeEleven(status = 200) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, key: init.headers['xi-api-key'], body: JSON.parse(init.body) });
		return status === 200 ? new Response(AUDIO, { status }) : new Response('nope', { status });
	};
	return { impl, calls };
}

test('an idea becomes a prompt in the wall\'s style', () => {
	assert.equal(cleanIdea('make me a sound of a doorbell!'), 'a doorbell');
	assert.equal(cleanIdea('Could you generate a sound effect for pouring tea'), 'pouring tea');
	assert.equal(cleanIdea('  a   wooden   door '), 'a wooden door');
	assert.equal(cleanIdea('x'), '');
	assert.equal(cleanIdea('<b>a bell</b>'), 'a bell');
	assert.equal(cleanIdea('word '.repeat(60)).length <= 140, true);

	const built = buildSoundPrompt('a doorbell');
	assert.equal(built.idea, 'a doorbell');
	assert.equal(built.prompt, `a doorbell, ${ROOM}`, 'asked for a bell, so no "no bells"');
	assert.equal(buildSoundPrompt('a pencil tap').prompt, `a pencil tap, ${ROOM}, ${NO_BELLS}`, 'otherwise the wall has no bells');
	assert.ok(built.prompt.endsWith(ROOM));
	assert.equal(buildSoundPrompt('!a harsh buzzer').prompt, 'a harsh buzzer', '"!" sends it as typed');
	assert.equal(buildSoundPrompt('a bell in a quiet room, no music').prompt, 'a bell in a quiet room, no music', 'already styled');
	assert.equal(buildSoundPrompt('a click on a quiet desk').prompt, 'a click on a quiet desk');
	assert.equal(buildSoundPrompt('').prompt, '');
});

test('names, lengths', () => {
	assert.equal(soundName('Pouring tea into a cup!'), 'pouring-tea-into-cup');
	assert.equal(soundName('A door', ['door']), 'door-2');
	assert.equal(soundName('!!!'), 'sound');
	assert.match(soundName('x'.repeat(80)), /^[a-z0-9][a-z0-9-]{0,31}$/);
	assert.equal(clampSeconds(99), 6);
	assert.equal(clampSeconds(0.1), 0.5);
	assert.equal(clampSeconds('nonsense', 1.5), 1.5);
	assert.ok(guessSeconds('a ringing alarm') > guessSeconds('a pencil tap'));
	assert.equal(libraryRequest('timer').name, 'timer');
	assert.equal(libraryRequest('nope'), null);
});

test('making, assigning and deleting sounds', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'snd-'));
	const { impl, calls } = fakeEleven();
	const sent = [];
	let key = '';
	const hub = createSoundHub({ dataDir, getKey: () => key, broadcast: (m) => sent.push(m), fetchImpl: impl, now: () => Date.UTC(2026, 9, 9, 15), env: {}, log: quiet });

	assert.deepEqual(await hub.generate({ idea: 'a doorbell' }), { ok: false, error: 'no-key' });
	assert.equal(calls.length, 0, 'nothing is sent without a key');
	key = 'sk_test_0123456789abcdef0123';

	assert.deepEqual(await hub.generate({ idea: ' ' }), { ok: false, error: 'empty' });
	assert.deepEqual(await hub.generate({ kind: 'nonsense' }), { ok: false, error: 'unknown-kind' });

	const made = await hub.generate({ idea: 'make a sound of a doorbell', seconds: 99 });
	assert.equal(made.ok, true);
	assert.equal(made.name, 'doorbell');
	assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/sound-generation');
	assert.equal(calls[0].key, key);
	assert.equal(calls[0].body.duration_seconds, 6, 'length is clamped');
	assert.ok(calls[0].body.text.endsWith(ROOM));
	assert.ok(existsSync(path.join(dataDir, 'sounds', 'doorbell.mp3')));
	assert.ok(sent.some((m) => m.type === 'sounds-changed'), 'the kiosk is told to reload');

	// a second one with the same idea doesn't overwrite the first
	assert.equal((await hub.generate({ idea: 'a doorbell', seconds: 1 })).name, 'doorbell-2');

	// the key never appears in what the phone is sent
	assert.ok(!JSON.stringify(hub.snapshot()).includes('sk_test'));
	assert.equal(hub.snapshot().hasKey, true);
	assert.deepEqual(Object.keys(hub.snapshot().sounds), ['doorbell', 'doorbell-2']);

	// a library stand-in takes over its own event
	const lib = await hub.generate({ kind: 'timer' });
	assert.equal(lib.ok, true);
	assert.equal(lib.assigned, 'timer');
	assert.equal(lib.name, 'lib-timer');
	assert.equal(hub.snapshot().assign.timer, 'lib-timer');
	assert.match(calls.at(-1).body.text, /desk timer/);

	// assign a custom sound to another event, and take it away again
	assert.deepEqual(hub.assign('reminder', 'doorbell'), { ok: true, assign: { timer: 'lib-timer', reminder: 'doorbell' } });
	assert.deepEqual(hub.assign('bogus', 'doorbell'), { ok: false, error: 'unknown-kind' });
	assert.deepEqual(hub.assign('reminder', 'ghost'), { ok: false, error: 'not-found' });
	assert.deepEqual(hub.assign('reminder', null).assign, { timer: 'lib-timer' });

	// deleting drops its assignments and its file
	hub.assign('reminder', 'doorbell');
	assert.deepEqual(hub.remove('doorbell'), { ok: true });
	assert.ok(!existsSync(path.join(dataDir, 'sounds', 'doorbell.mp3')));
	assert.equal(hub.snapshot().assign.reminder, undefined);
	assert.deepEqual(hub.remove('../../etc/passwd'), { ok: false, error: 'not-found' });

	// it survives a restart
	const again = createSoundHub({ dataDir, getKey: () => key, fetchImpl: impl, env: {}, log: quiet });
	assert.deepEqual(Object.keys(again.snapshot().sounds).sort(), ['doorbell-2', 'lib-timer']);
});

test('budget, cap and ElevenLabs trouble', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'snd-'));
	const ok = fakeEleven();
	let day = Date.UTC(2026, 9, 9, 15);
	const hub = createSoundHub({ dataDir, getKey: () => 'sk_test_0123456789abcdef0123', fetchImpl: ok.impl, now: () => day, env: {}, log: quiet, dailySeconds: 5 });
	assert.equal((await hub.generate({ idea: 'a long ring', seconds: 3 })).ok, true);
	assert.equal(hub.snapshot().secondsToday, 3);
	assert.deepEqual(await hub.generate({ idea: 'another ring', seconds: 3 }), { ok: false, error: 'daily-limit' });
	assert.equal(ok.calls.length, 1, 'nothing is sent once the budget is spent');
	day += 24 * 3600000;
	assert.equal(hub.snapshot().secondsToday, 0, 'a new day');
	assert.equal((await hub.generate({ idea: 'another ring', seconds: 3 })).ok, true);

	for (const [status, error] of [[401, 'bad-key'], [429, 'rate-limited'], [500, 'failed']]) {
		const bad = createSoundHub({ dataDir: mkdtempSync(path.join(tmpdir(), 'snd-')), getKey: () => 'sk_test_0123456789abcdef0123', fetchImpl: fakeEleven(status).impl, env: {}, log: quiet });
		assert.deepEqual(await bad.generate({ idea: 'a bell' }), { ok: false, error });
		assert.deepEqual(bad.snapshot().sounds, {}, 'a failure leaves nothing behind');
	}
	const tiny = createSoundHub({ dataDir: mkdtempSync(path.join(tmpdir(), 'snd-')), getKey: () => 'k'.repeat(24), fetchImpl: async () => new Response('x'), env: {}, log: quiet });
	assert.equal((await tiny.generate({ idea: 'a bell' })).error, 'failed', 'an error page is not audio');

	// the cap
	const capped = createSoundHub({ dataDir: mkdtempSync(path.join(tmpdir(), 'snd-')), getKey: () => 'k'.repeat(24), fetchImpl: fakeEleven().impl, env: {}, log: quiet, dailySeconds: 9999 });
	for (let i = 0; i < 24; i++) assert.equal((await capped.generate({ idea: `bell number ${i}`, seconds: 0.5 })).ok, true);
	assert.deepEqual(await capped.generate({ idea: 'one bell too many' }), { ok: false, error: 'too-many' });
});

test('two taps at once are made one after the other', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'snd-'));
	let running = 0;
	let overlap = 0;
	const impl = async () => {
		running++;
		overlap = Math.max(overlap, running);
		await new Promise((r) => setTimeout(r, 15));
		running--;
		return new Response(AUDIO);
	};
	const hub = createSoundHub({ dataDir, getKey: () => 'k'.repeat(24), fetchImpl: impl, env: {}, log: quiet });
	const all = await Promise.all([hub.generate({ idea: 'a bell' }), hub.generate({ idea: 'a bell' }), hub.generate({ idea: 'a bell' })]);
	assert.deepEqual(all.map((r) => r.name), ['bell', 'bell-2', 'bell-3'], 'no two take the same name');
	assert.equal(overlap, 1);
});

test('HTTP: the list and clips are open, changes need the token', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'snd-'));
	const hub = createSoundHub({ dataDir, getKey: () => 'k'.repeat(24), fetchImpl: fakeEleven().impl, env: {}, log: quiet });
	const server = createServer(async (req, res) => {
		if (await hub.handleHttp(req, res)) return;
		res.writeHead(404);
		res.end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const call = (method, p, body, headers = {}) => fetch(base + p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
	try {
		let res = await call('POST', '/api/sounds/generate', { idea: 'a doorbell' });
		assert.equal(res.status, 200);
		assert.equal((await res.json()).name, 'doorbell');

		res = await call('GET', '/api/sounds/custom');
		assert.deepEqual(Object.keys((await res.json()).sounds), ['doorbell']);
		res = await call('GET', '/api/sounds/custom/doorbell.mp3');
		assert.equal(res.headers.get('content-type'), 'audio/mpeg');
		assert.equal(Buffer.from(await res.arrayBuffer()).length, AUDIO.length);
		assert.equal((await call('GET', '/api/sounds/custom/..%2Fcustom.json')).status, 404);
		assert.equal((await call('GET', '/api/sounds/custom/nothing.mp3')).status, 404);

		assert.equal((await call('POST', '/api/sounds/generate', { idea: '' })).status, 400);
		res = await call('POST', '/api/sounds/assign', { kind: 'timer', name: 'doorbell' });
		assert.deepEqual((await res.json()).assign, { timer: 'doorbell' });
		assert.equal((await call('POST', '/api/sounds/assign', { kind: 'timer', name: 'ghost' })).status, 404);

		writeFileSync(path.join(dataDir, 'api-token'), 'secret');
		assert.equal((await call('POST', '/api/sounds/generate', { idea: 'a bell' })).status, 401);
		assert.equal((await call('DELETE', '/api/sounds/custom/doorbell')).status, 401);
		assert.equal((await call('GET', '/api/sounds/custom')).status, 200, 'the kiosk\'s player can still read');
		assert.equal((await call('DELETE', '/api/sounds/custom/doorbell', undefined, { Authorization: 'Bearer secret' })).status, 200);
		assert.equal(JSON.parse(readFileSync(path.join(dataDir, 'sounds', 'custom.json'), 'utf8')).assign.timer, undefined);
	} finally {
		server.close();
	}
});

test('the library is one family: every prompt ends on the same desk', async () => {
	const { SOUND_LIBRARY, DESK } = await import('../src/lib/sounds/library.js');
	const suffix = `, ${DESK}, ${NO_BELLS}`;
	for (const s of SOUND_LIBRARY) {
		assert.ok(s.prompt.endsWith(suffix), s.name);
		const what = s.prompt.slice(0, -suffix.length);
		assert.doesNotMatch(what, /\b(?:brass|crystal|marimba|wooden room|beeps?|bells?|chimes?|dings?|ring(?:s|ing)?|tings?)\b/i, `${s.name}: no bells`);
		assert.ok(s.seconds >= 0.5 && s.seconds <= 30 && s.gain > 0 && s.gain <= 1, s.name);
	}
	assert.equal(new Set(SOUND_LIBRARY.map((s) => s.name)).size, SOUND_LIBRARY.length);
});
