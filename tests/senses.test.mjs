import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	DEFAULT_SENSES,
	describeDistance,
	hushMsFor,
	normalizeSensesSettings,
	notesCommand,
	presenceChanged,
	presenceFrom,
	transcriptText
} from '../src/lib/senses.js';
import { createSensesHub } from '../src/lib/server/sensesHub.js';

function fakeReq(method, url, { body, headers = {}, local = true } = {}) {
	const listeners = {};
	const raw = body === undefined ? '' : JSON.stringify(body);
	const req = {
		method,
		url,
		headers,
		local,
		on(ev, fn) {
			listeners[ev] = fn;
			if (ev === 'end')
				setImmediate(() => {
					if (raw) listeners.data?.(raw);
					fn();
				});
			return req;
		},
		destroy() {}
	};
	return req;
}

function fakeRes() {
	const res = {
		status: 0,
		body: '',
		writeHead(s) {
			res.status = s;
		},
		end(b) {
			res.body = b ?? '';
		},
		json() {
			return JSON.parse(res.body);
		}
	};
	return res;
}

function hub(over = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'senses-'));
	const sent = [];
	const spoken = [];
	const commands = [];
	const near = [];
	let t = Date.parse('2026-10-14T15:00:00Z');
	const h = createSensesHub({
		dataDir,
		broadcast: (m) => sent.push(m),
		command: async (text) => {
			commands.push(text);
			return { say: `Did: ${text}.` };
		},
		say: async (text) => spoken.push(text),
		isLocal: (req) => req.local !== false,
		onNear: (p) => near.push(p),
		now: () => t,
		log: () => {},
		timeZone: 'America/New_York',
		...over
	});
	return { h, dataDir, sent, spoken, commands, near, advance: (ms) => (t += ms) };
}

async function post(h, url, body, opts) {
	const res = fakeRes();
	await h.handleHttp(fakeReq('POST', url, { body, ...opts }), res);
	return res;
}

/* ---------- pure helpers ---------- */

test('settings: off by default, clamped, unknown values fall back', () => {
	const s = normalizeSensesSettings({});
	assert.equal(s.mic, false);
	assert.equal(s.camera, false);
	const t = normalizeSensesSettings({ nearMeters: 99, model: 'huge', wakeMode: 'telepathy', wakeWords: 'Hey Wall!, computer', language: 'xx-yy', extra: 1 });
	assert.equal(t.nearMeters, 6);
	assert.equal(t.model, DEFAULT_SENSES.model);
	assert.equal(t.wakeMode, 'phrase');
	assert.deepEqual(t.wakeWords, ['hey wall', 'computer']);
	assert.equal(t.language, 'en');
	assert.equal('extra' in t, false);
	// a patch keeps the rest
	assert.equal(normalizeSensesSettings({ mic: true }, t).nearMeters, 6);
});

test('notes commands', () => {
	assert.equal(notesCommand('start taking notes'), 'start');
	assert.equal(notesCommand('Take notes.'), 'start');
	assert.equal(notesCommand('start transcribing'), 'start');
	assert.equal(notesCommand('stop taking notes'), 'stop');
	assert.equal(notesCommand('Stop transcribing, please'), 'stop');
	assert.equal(notesCommand('remind me to take notes at 5'), null);
	assert.equal(notesCommand('stop'), null);
});

test('presence: numbers only, near by distance, nothing when offline', () => {
	const p = presenceFrom({ ok: true, count: 2, distance: 1.234, x: 0.4, motion: 0.1, frame: 'nope' }, DEFAULT_SENSES);
	assert.deepEqual(p, { camera: true, count: 2, distance: 1.23, x: 0.4, motion: 0.1, near: true, calibrated: false });
	assert.equal(presenceFrom({ ok: true, count: 1, distance: 3 }, DEFAULT_SENSES).near, false);
	assert.equal(presenceFrom({ ok: true, count: 1, distance: 1 }, DEFAULT_SENSES, false).count, 0);
	assert.equal(presenceFrom({ ok: true, count: 0, distance: 1 }, DEFAULT_SENSES).distance, null);
});

test('presence: small wobbles are not news', () => {
	const a = presenceFrom({ ok: true, count: 1, distance: 2, x: 0 }, DEFAULT_SENSES);
	assert.equal(presenceChanged(a, presenceFrom({ ok: true, count: 1, distance: 2.05, x: 0.03 }, DEFAULT_SENSES)), false);
	assert.equal(presenceChanged(a, presenceFrom({ ok: true, count: 1, distance: 2.3, x: 0 }, DEFAULT_SENSES)), true);
	assert.equal(presenceChanged(a, presenceFrom({ ok: true, count: 2, distance: 2, x: 0 }, DEFAULT_SENSES)), true);
});

test('hush, distance words, transcript text', () => {
	assert.ok(hushMsFor('Pasta timer is done.') > 1500);
	assert.equal(hushMsFor('x'.repeat(10000)), 30000);
	assert.equal(describeDistance(0.6), '60 cm');
	assert.equal(describeDistance(1.44), '1.4 m');
	assert.equal(describeDistance(null), '');
	const txt = transcriptText([{ at: '2026-10-14T15:05:00Z', text: 'Paint the hall.' }], { timeZone: 'America/New_York' });
	assert.match(txt, /\[11:05 AM\] Paint the hall\./);
});

/* ---------- the hub ---------- */

test('state: only from this machine; answers with settings, hush and notes', async () => {
	const { h } = hub();
	let res = await post(h, '/api/senses/state', { camera: { ok: true } }, { local: false });
	assert.equal(res.status, 403);
	res = await post(h, '/api/senses/state', { camera: { ok: false }, mic: { ok: true, state: 'idle' } });
	assert.equal(res.status, 200);
	const body = res.json();
	assert.equal(body.settings.mic, false);
	assert.equal(body.hushMs, 0);
	assert.equal(body.notes, false);
	assert.equal(body.calibrate, null);
	assert.equal(h.snapshot().online, true);
});

test('GET needs the token from elsewhere, not from here', async () => {
	const { h, dataDir } = hub();
	writeFileSync(path.join(dataDir, 'api-token'), 'tok');
	let res = fakeRes();
	await h.handleHttp(fakeReq('GET', '/api/senses', { local: false }), res);
	assert.equal(res.status, 401);
	res = fakeRes();
	await h.handleHttp(fakeReq('GET', '/api/senses', { local: false, headers: { authorization: 'Bearer tok' } }), res);
	assert.equal(res.status, 200);
	res = fakeRes();
	await h.handleHttp(fakeReq('GET', '/api/senses'), res);
	assert.equal(res.status, 200);
	res = fakeRes();
	assert.equal(await h.handleHttp(fakeReq('GET', '/api/sensesx'), res), false);
});

test('the wall hushes its ears while it talks', async () => {
	const { h } = hub();
	h.noteSpeaking('The pasta timer is done.');
	const res = await post(h, '/api/senses/state', {});
	assert.ok(res.json().hushMs > 1500);
});

test('presence: broadcast on change, onNear on walking up, saved settings survive', async () => {
	const { h, sent, near, dataDir } = hub();
	h.handleWs({ op: 'set', patch: { camera: true } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, distance: 3, x: 0 } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, distance: 1.1, x: 0.1 } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, distance: 1.12, x: 0.1 } });
	const presences = sent.filter((m) => m.type === 'presence');
	assert.equal(presences.length, 2);
	assert.equal(presences[1].near, true);
	assert.equal(near.length, 1);
	assert.equal(JSON.parse(readFileSync(path.join(dataDir, 'senses.json'), 'utf8')).camera, true);
});

test('presence ignores the camera when it is turned off', async () => {
	const { h } = hub();
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, distance: 1 } });
	assert.equal(h.presence().count, 0);
});

test('heard: a command goes to "tell the wall" and the answer is spoken', async () => {
	const { h, commands, spoken, sent } = hub();
	const res = await post(h, '/api/senses/heard', { kind: 'command', text: 'pause the music' });
	assert.equal(res.json().say, 'Did: pause the music.');
	assert.deepEqual(commands, ['pause the music']);
	assert.deepEqual(spoken, ['Did: pause the music.']);
	assert.ok(sent.some((m) => m.type === 'heard' && m.text === 'pause the music'));
});

test('heard: captions off keeps what you said off the island', async () => {
	const { h, sent } = hub();
	h.handleWs({ op: 'set', patch: { captions: false } });
	await post(h, '/api/senses/heard', { kind: 'command', text: 'what time is it' });
	assert.equal(sent.some((m) => m.type === 'heard'), false);
});

test('notes: by voice, kept while on, saved as text when stopped', async () => {
	const { h, dataDir, spoken, commands } = hub();
	h.handleWs({ op: 'set', patch: { mic: true } });
	await post(h, '/api/senses/heard', { kind: 'note', text: 'ignored while notes are off' });
	await post(h, '/api/senses/heard', { kind: 'command', text: 'start taking notes' });
	assert.equal(h.snapshot().notes.on, true);
	await post(h, '/api/senses/heard', { kind: 'note', text: 'Paint the hall blue.' });
	await post(h, '/api/senses/heard', { kind: 'note', text: 'Ask about the gutters.' });
	await post(h, '/api/senses/heard', { kind: 'command', text: 'stop taking notes' });
	assert.equal(commands.length, 0, 'notes commands never reach the task list');
	assert.match(spoken.at(-1), /2 lines saved/);
	const files = readdirSync(path.join(dataDir, 'transcripts'));
	assert.equal(files.length, 1);
	const text = readFileSync(path.join(dataDir, 'transcripts', files[0]), 'utf8');
	assert.match(text, /Paint the hall blue\.\n.*Ask about the gutters\./);
	assert.doesNotMatch(text, /ignored/);
	assert.deepEqual(h.handleWs({ op: 'transcripts' }).transcripts, files);
	assert.match(h.handleWs({ op: 'transcript', name: files[0] }).transcript.text, /gutters/);
	assert.equal(h.handleWs({ op: 'transcript', name: '../senses.json' }).result.error, 'not-found');
});

test('notes stop by themselves after a quiet stretch', async () => {
	const { h, advance } = hub();
	h.handleWs({ op: 'set', patch: { mic: true, notesMinutes: 5 } });
	h.handleWs({ op: 'notes-start' });
	advance(6 * 60000);
	h.tick();
	assert.equal(h.snapshot().notes.on, false);
});

test('notes need the microphone on; turning it off stops them', () => {
	const { h } = hub();
	assert.equal(h.handleWs({ op: 'notes-start' }).result.error, 'mic-off');
	h.handleWs({ op: 'set', patch: { mic: true } });
	h.handleWs({ op: 'notes-start' });
	h.handleWs({ op: 'set', patch: { mic: false } });
	assert.equal(h.snapshot().notes.on, false);
});

test('an unpaired phone can look but not change', () => {
	const { h } = hub();
	const out = h.handleWs({ op: 'set', patch: { mic: true } }, { mayChange: false });
	assert.equal(out.result.error, 'not-paired');
	assert.equal(h.snapshot().settings.mic, false);
});

test('calibrating: the phone asks, the process measures, the focal length is saved', async () => {
	const { h } = hub();
	h.handleWs({ op: 'set', patch: { camera: true } });
	assert.equal(h.handleWs({ op: 'calibrate', meters: 1 }).result.error, 'camera-off', 'the process has not checked in yet');
	await post(h, '/api/senses/state', { camera: { ok: true } });
	const { result } = h.handleWs({ op: 'calibrate', meters: 1 });
	assert.equal(result.ok, true);
	const job = (await post(h, '/api/senses/state', { camera: { ok: true } })).json().calibrate;
	assert.deepEqual(job, { id: result.id, meters: 1 });
	await post(h, '/api/senses/calibrated', { id: 'someone-else', focalPx: 1 });
	assert.equal(h.snapshot().settings.focalPx, null);
	await post(h, '/api/senses/calibrated', { id: result.id, focalPx: 400, focalWidth: 320, samples: 12 });
	const s = h.snapshot();
	assert.equal(s.settings.focalPx, 400);
	assert.equal(s.calibrated.ok, true);
	assert.equal((await post(h, '/api/senses/state', {})).json().calibrate, null);
	// the phone can't type a focal length in, only clear it
	h.handleWs({ op: 'set', patch: { focalPx: 9999 } });
	assert.equal(h.snapshot().settings.focalPx, 400);
	h.handleWs({ op: 'set', patch: { focalPx: null } });
	assert.equal(h.snapshot().settings.focalPx, null);
});

test('calibrating with nobody in view says so', async () => {
	const { h } = hub();
	h.handleWs({ op: 'set', patch: { camera: true } });
	await post(h, '/api/senses/state', { camera: { ok: true } });
	const { result } = h.handleWs({ op: 'calibrate', meters: 1 });
	await post(h, '/api/senses/calibrated', { id: result.id, error: 'no-face' });
	assert.deepEqual([h.snapshot().calibrated.ok, h.snapshot().calibrated.error], [false, 'no-face']);
});

test('the process going away clears presence', async () => {
	const { h, advance } = hub();
	h.handleWs({ op: 'set', patch: { camera: true } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, distance: 1 } });
	assert.equal(h.presence().count, 1);
	advance(10000);
	h.tick();
	assert.equal(h.presence().count, 0);
	assert.equal(h.snapshot().online, false);
});

test('presence: a margin past the line, so standing on it does not flicker', () => {
	const at = (d, wasNear) => presenceFrom({ ok: true, count: 1, distance: d }, DEFAULT_SENSES, true, wasNear).near;
	assert.equal(at(1.6, false), false, 'not yet near');
	assert.equal(at(1.4, false), true);
	assert.equal(at(1.6, true), true, 'still near just past the line');
	assert.equal(at(1.9, true), false, 'gone once well past it');
});
