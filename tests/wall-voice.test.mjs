import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inQuietHours, speechText, speechForDue, normalizeVoiceSettings, voiceVolumeAt, roomVolume, welcomeBackText, DEFAULT_VOICE } from '../src/lib/wallVoice.js';
import { createVoiceHub, clipKey, loadElevenLabsKey } from '../src/lib/server/voiceHub.js';
import { parseCommand } from '../src/lib/wallActions.js';
import { chimeKindForEvent, islandOwnsChime } from '../src/lib/chimeKind.js';
import { SOUND_LIBRARY } from '../src/lib/sounds/library.js';

// 2026-10-10 is EDT (UTC-4): noon on the wall is 16:00Z
const NOON = Date.parse('2026-10-10T16:00:00Z');
const ELEVEN_PM = Date.parse('2026-10-11T03:00:00Z');
const SIX_AM = Date.parse('2026-10-11T10:00:00Z');
const SEVEN_AM = Date.parse('2026-10-11T11:00:00Z');

function fakeEleven({ status = 200, bytes = 'ID3fake-mp3' } = {}) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init, body: JSON.parse(init.body) });
		return {
			ok: status >= 200 && status < 300,
			status,
			arrayBuffer: async () => new TextEncoder().encode(bytes).buffer
		};
	};
	return { calls, fetchImpl };
}

function hub({ key = 'sk_test', at = NOON, fetchImpl, settings, room } = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'voice-'));
	if (settings) writeFileSync(path.join(dataDir, 'voice.json'), JSON.stringify(settings));
	const sent = [];
	const clock = { now: at };
	const h = createVoiceHub({
		dataDir,
		broadcast: (m) => sent.push(m),
		fetchImpl,
		now: () => clock.now,
		env: key ? { ELEVENLABS_API_KEY: key } : {},
		log: { warn() {} },
		...(room ? { room } : {})
	});
	return { h, sent, dataDir, clock };
}

test('quiet hours wrap midnight on the wall clock', () => {
	assert.equal(voiceVolumeAt(NOON, DEFAULT_VOICE), 0.5);
	assert.equal(voiceVolumeAt(ELEVEN_PM, DEFAULT_VOICE), 0.22);
	const q = { quietStart: '22:00', quietEnd: '07:00' };
	assert.equal(inQuietHours(NOON, q), false);
	assert.equal(inQuietHours(ELEVEN_PM, q), true);
	assert.equal(inQuietHours(SIX_AM, q), true);
	assert.equal(inQuietHours(SEVEN_AM, q), false, 'the end is exclusive');
	assert.equal(inQuietHours(NOON, { quietStart: '11:00', quietEnd: '13:00' }), true, 'a daytime window works too');
	assert.equal(inQuietHours(NOON, { quietStart: '09:00', quietEnd: '09:00' }), false, 'an empty window is never quiet');
});

test('speech text: no markup, bounded, a capitalised sentence', () => {
	assert.equal(speechText('dinner is ready'), 'Dinner is ready.');
	assert.equal(speechText('  **Pizza**  is <b>here</b>! '), 'Pizza is here!');
	assert.equal(speechText('see https://example.com/x now'), 'See a link now.');
	assert.equal(speechText(''), '');
	const long = speechText('word '.repeat(200));
	assert.ok(long.length <= 280 && long.endsWith('…'));
});

test('what the wall says when timers and reminders come due', () => {
	assert.equal(speechForDue({ title: 'Timer: Pasta' }), 'Pasta timer is done.');
	assert.equal(speechForDue({ title: 'Timer' }), 'Your timer is done.');
	assert.equal(speechForDue({ title: 'Call mom' }), 'Reminder: Call mom.');
	assert.equal(speechForDue({ title: '' }), '');
});

test('settings keep good values and drop bad ones', () => {
	const s = normalizeVoiceSettings({ enabled: false, voiceId: 'bad id!', quietStart: '23:30', quietEnd: '25:00', dailyChars: -4, model: 'gpt' });
	assert.equal(s.enabled, false);
	assert.equal(s.voiceId, DEFAULT_VOICE.voiceId);
	assert.equal(s.quietStart, '23:30');
	assert.equal(s.quietEnd, DEFAULT_VOICE.quietEnd);
	assert.equal(s.dailyChars, DEFAULT_VOICE.dailyChars);
	assert.equal(s.model, DEFAULT_VOICE.model);
});

test('the key comes from the environment or the data file, never a request', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'key-'));
	const file = path.join(dir, 'elevenlabs-key');
	assert.equal(loadElevenLabsKey(file, {}), '');
	writeFileSync(file, '  sk_file \n');
	assert.equal(loadElevenLabsKey(file, {}), 'sk_file');
	assert.equal(loadElevenLabsKey(file, { ELEVENLABS_API_KEY: 'sk_env' }), 'sk_env');
});

test('say: synthesizes once, caches, and sends the clip to the wall', async () => {
	const eleven = fakeEleven();
	const { h, sent, dataDir } = hub({ fetchImpl: eleven.fetchImpl });
	const a = await h.say('dinner is ready', { source: 'iPhone' });
	assert.deepEqual(a, { ok: true, text: 'Dinner is ready.', spoken: true, volume: 0.5 });
	assert.equal(eleven.calls.length, 1);
	const call = eleven.calls[0];
	assert.match(call.url, /\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\?output_format=mp3_44100_128$/);
	assert.equal(call.init.headers['xi-api-key'], 'sk_test');
	assert.deepEqual(call.body, { text: 'Dinner is ready.', model_id: 'eleven_flash_v2_5' });
	const id = clipKey(DEFAULT_VOICE.voiceId, DEFAULT_VOICE.model, 'Dinner is ready.');
	assert.ok(existsSync(path.join(dataDir, 'voice-cache', `${id}.mp3`)));
	assert.equal(sent[0].type, 'speak');
	assert.equal(sent[0].url, `/api/voice/clip/${id}.mp3`);
	assert.equal(sent[0].source, 'iPhone');
	assert.equal(sent[0].caption, true);

	await h.say('Dinner is ready.');
	assert.equal(eleven.calls.length, 1, 'the second time is free');
	assert.equal(h.snapshot().charsToday, 'Dinner is ready.'.length, 'only new text counts');
	assert.match(readFileSync(path.join(dataDir, 'voice-usage.json'), 'utf8'), /"chars":16/);
});

test('say: captions only without a key, in quiet hours, when off, or over budget', async () => {
	const eleven = fakeEleven();
	const noKey = hub({ key: '', fetchImpl: eleven.fetchImpl });
	assert.equal((await noKey.h.say('hello')).silent, 'no-key');
	assert.equal(noKey.sent[0].url, null);
	assert.equal(noKey.sent[0].text, 'Hello.');

	const night = hub({ at: ELEVEN_PM, fetchImpl: eleven.fetchImpl, settings: { nightSilent: true } });
	assert.equal((await night.h.say('hello')).silent, 'quiet-hours', 'silent at night when asked');
	assert.equal((await night.h.say('the house is on fire', { urgent: true })).spoken, true, 'urgent speaks anyway');

	const off = hub({ fetchImpl: eleven.fetchImpl, settings: { enabled: false } });
	assert.equal((await off.h.say('hello')).silent, 'off');

	const tight = hub({ fetchImpl: eleven.fetchImpl, settings: { dailyChars: 10 } });
	assert.equal((await tight.h.say('this sentence is longer than ten')).silent, 'daily-limit');
	assert.equal(eleven.calls.length, 1, 'only the urgent one reached ElevenLabs');
});

test('the voice is softer at night, and only the voice', async () => {
	const eleven = fakeEleven();
	const day = hub({ fetchImpl: eleven.fetchImpl });
	const said = await day.h.say('Dinner is ready.');
	assert.equal(said.spoken, true);
	assert.equal(said.volume, 0.5, 'day: 50%');
	assert.equal(day.sent.at(-1).volume, 0.5, 'the clip carries its volume to the wall');
	assert.equal(day.h.snapshot().volumeNow, 0.5);

	const night = hub({ at: ELEVEN_PM, fetchImpl: eleven.fetchImpl });
	const late = await night.h.say('Pasta timer is done.');
	assert.equal(late.spoken, true, 'night speaks, quietly, instead of going silent');
	assert.equal(late.volume, 0.22, 'night: 22%');
	assert.equal(night.sent.at(-1).volume, 0.22);
	assert.equal((await night.h.say('Fire!', { urgent: true })).volume, 0.22, 'urgent follows the night volume too');

	const custom = hub({ at: ELEVEN_PM, fetchImpl: eleven.fetchImpl, settings: { nightVolume: 15, dayVolume: 0.8 } });
	assert.equal((await custom.h.say('hi')).volume, 0.15, 'a percent works too');
	assert.equal(custom.h.snapshot().dayVolume, 0.8);
});

test('say: ElevenLabs failures fall back to the caption', async () => {
	const bad = hub({ fetchImpl: fakeEleven({ status: 401 }).fetchImpl });
	assert.equal((await bad.h.say('hello')).silent, 'bad-key');
	const busy = hub({ fetchImpl: fakeEleven({ status: 429 }).fetchImpl });
	assert.equal((await busy.h.say('hello')).silent, 'rate-limited');
	const down = hub({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
	const r = await down.h.say('hello');
	assert.equal(r.silent, 'tts-failed');
	assert.equal(down.sent[0].url, null);
	assert.equal(readdirSync(down.dataDir).includes('voice-cache'), false, 'nothing half-written');
});

test('say: nothing to say is not broadcast', async () => {
	const { h, sent } = hub({ fetchImpl: fakeEleven().fetchImpl });
	assert.deepEqual(await h.say('   '), { ok: false, error: 'empty' });
	assert.equal(sent.length, 0);
});

function fakeRes() {
	const res = { status: 0, headers: {}, body: '' };
	res.writeHead = (s, h) => {
		res.status = s;
		Object.assign(res.headers, h);
	};
	res.end = (b = '') => (res.body += b);
	res.on = res.once = res.emit = () => res;
	res.write = (b) => (res.body += b);
	return res;
}

function fakeReq(method, url, { body = '', headers = {} } = {}) {
	const listeners = {};
	const req = {
		method,
		url,
		headers,
		on(ev, fn) {
			listeners[ev] = fn;
			if (ev === 'end') setImmediate(() => {
				if (body) listeners.data?.(body);
				fn();
			});
			return req;
		},
		destroy() {}
	};
	return req;
}

test('http: the API needs the token; clips are served by hash only', async () => {
	const { h, dataDir } = hub({ fetchImpl: fakeEleven().fetchImpl });
	writeFileSync(path.join(dataDir, 'api-token'), 'tok');
	let res = fakeRes();
	await h.handleHttp(fakeReq('GET', '/api/voice'), res);
	assert.equal(res.status, 401);

	res = fakeRes();
	await h.handleHttp(fakeReq('POST', '/api/voice/say?format=text', { body: 'announce me', headers: { authorization: 'Bearer tok', 'content-type': 'text/plain' } }), res);
	assert.equal(res.status, 200);
	assert.equal(res.body, 'Said on the wall.');

	res = fakeRes();
	await h.handleHttp(fakeReq('GET', '/api/voice', { headers: { authorization: 'Bearer tok' } }), res);
	const snap = JSON.parse(res.body);
	assert.equal(snap.hasKey, true);
	assert.equal(JSON.stringify(snap).includes('sk_test'), false, 'the key is never sent back');

	res = fakeRes();
	await h.handleHttp(fakeReq('GET', '/api/voice/clip/..%2Fapi-token'), res);
	assert.equal(res.status, 404, 'no path tricks');

	assert.equal(await h.handleHttp(fakeReq('GET', '/api/tasks'), fakeRes()), false, 'other routes pass through');
});

test('"announce …" and "tell everyone …" are announcements, reminders are not', () => {
	assert.deepEqual(parseCommand('Announce dinner is ready!'), { intent: 'announce', text: 'dinner is ready' });
	assert.deepEqual(parseCommand('tell everyone that we leave in five minutes'), { intent: 'announce', text: 'we leave in five minutes' });
	assert.equal(parseCommand('remind me to announce the winner at 5'), null);
});

test('due alerts ring their own sounds; spoken captions stay quiet', () => {
	assert.equal(chimeKindForEvent({ kind: 'alert', title: 'Timer: Pasta' }), 'timer');
	assert.equal(chimeKindForEvent({ kind: 'alert', title: 'Call mom' }), 'reminder');
	assert.equal(chimeKindForEvent({ kind: 'approval' }), 'approval');
	assert.equal(islandOwnsChime('speak'), false);
});

test('sound library: unique names, sane lengths, one quiet desk, no bells', () => {
	const names = SOUND_LIBRARY.map((s) => s.name);
	assert.equal(new Set(names).size, names.length);
	for (const s of SOUND_LIBRARY) {
		assert.match(s.name, /^[a-z-]+$/);
		assert.ok(s.seconds >= 0.5 && s.seconds <= 30, `${s.name} length`);
		assert.ok(s.influence >= 0 && s.influence <= 1, `${s.name} influence`);
		assert.ok(s.gain > 0 && s.gain <= 1, `${s.name} gain`);
		assert.match(s.prompt, /no music, no voice, no bells, no chimes, no dings, no ringing$/, `${s.name} keeps the shared desk`);
	}
	// every sound the wall or the phone plays is in the library, down to the small ones
	for (const kind of ['tap', 'swap-next', 'swap-prev', 'volume', 'mute', 'unmute', 'morning', 'goodnight']) assert.ok(names.includes(kind), kind);
});

test('a key typed on the phone is checked, saved owner-only, and never read back', async () => {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, key: init.headers['xi-api-key'] });
		if (init.headers['xi-api-key'] === 'sk_bad_000000000000000000000') return { ok: false, status: 401, text: async () => '{"detail":{"status":"invalid_api_key"}}' };
		if (init.headers['xi-api-key'] === 'sk_restricted_0000000000000000') return { ok: false, status: 401, text: async () => '{"detail":{"status":"missing_permissions"}}' };
		return { ok: true, status: 200, text: async () => '{}' };
	};
	const { h, dataDir } = hub({ key: '', fetchImpl });
	const file = path.join(dataDir, 'elevenlabs-key');

	assert.deepEqual(await h.setKey('nope'), { ok: false, error: 'bad-format' });
	assert.deepEqual(await h.setKey('sk_bad_000000000000000000000'), { ok: false, error: 'invalid' });
	assert.equal(existsSync(file), false, 'a refused key is not saved');

	assert.deepEqual(await h.setKey('  sk_good_1234567890abcdef9f3a  '), { ok: true, verified: true });
	assert.equal(calls.at(-1).url, 'https://api.elevenlabs.io/v1/user');
	assert.equal(readFileSync(file, 'utf8').trim(), 'sk_good_1234567890abcdef9f3a');
	assert.equal(statSync(file).mode & 0o777, 0o600);
	const snap = h.snapshot();
	assert.equal(snap.hasKey, true);
	assert.equal(snap.keySource, 'file');
	assert.equal(snap.keyHint, '…9f3a');
	assert.equal(JSON.stringify(snap).includes('sk_good'), false, 'the snapshot never carries the key');

	// a restricted key that can't read the account is still saved
	assert.deepEqual(await h.setKey('sk_restricted_0000000000000000'), { ok: true, verified: false });

	assert.deepEqual(h.forgetKey(), { ok: true });
	assert.equal(existsSync(file), false);
	assert.equal(h.snapshot().hasKey, false);
});

test('a key from the environment wins and is reported as such', () => {
	const { h } = hub({ key: 'sk_env_key_abcdefghijklmn1234', fetchImpl: fakeEleven().fetchImpl });
	assert.equal(h.snapshot().keySource, 'env');
	assert.equal(h.snapshot().keyHint, '…1234');
});

/* ---------- the voice and the room ---------- */

test('room volume: louder across the room, softer up close and lying down at night', () => {
	const seen = (distance, posture = 'upright') => ({ camera: true, count: 1, distance, posture });
	assert.equal(roomVolume(0.5, null), 0.5);
	assert.equal(roomVolume(0.5, { camera: true, count: 0 }), 0.5);
	assert.equal(roomVolume(0.5, seen(null)), 0.5);
	assert.equal(roomVolume(0.5, seen(0.8)), 0.38);
	assert.equal(roomVolume(0.5, seen(4)), 0.63);
	assert.equal(roomVolume(0.22, seen(null, 'lying'), { quiet: true }), 0.13);
	assert.equal(roomVolume(0.5, seen(null, 'lying')), 0.5);
	assert.equal(roomVolume(0.9, seen(6)), 1);
});

test('said to an empty room: shown, held, and said in one go on return', async () => {
	let room = { camera: true, count: 0 };
	const { h, sent } = hub({ fetchImpl: fakeEleven().fetchImpl, room: () => room });
	const r = await h.say('Pasta timer is done');
	assert.equal(r.silent, 'away');
	assert.equal(sent.at(-1).url, null);
	assert.equal(h.snapshot().heldCount, 1);
	// urgent things speak anyway
	assert.equal((await h.say('Smoke alarm', { urgent: true })).silent, undefined);
	await h.say('Laundry is done');
	room = { camera: true, count: 1, distance: 2 };
	const back = await h.welcomeBack();
	assert.equal(back.text, 'While you were out: Pasta timer is done. Laundry is done.');
	assert.equal(back.silent, undefined);
	assert.equal(h.snapshot().heldCount, 0);
	assert.equal(await h.welcomeBack(), null);
});

test('holding and following the room can be turned off', async () => {
	const room = () => ({ camera: true, count: 0 });
	const { h } = hub({ fetchImpl: fakeEleven().fetchImpl, room, settings: { holdWhenAway: false } });
	assert.equal((await h.say('Hello')).silent, undefined);
	assert.equal(welcomeBackText([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }]), 'While you were out: B. C. D. And 1 more on the wall.');
});
