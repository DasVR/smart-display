import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	DEFAULT_SENSES,
	describeDistance,
	hushMsFor,
	newPlaceState,
	exitSideOf,
	normalizeSensesSettings,
	placeStep,
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
	const t = normalizeSensesSettings({ nearMeters: 99, model: 'small.en', wakeMode: 'telepathy', wakeWords: 'Hey Wall!, computer', language: 'xx-yy', extra: 1 });
	assert.equal(t.nearMeters, 6);
	// the old Whisper size and language settings are dropped (Parakeet replaced Whisper)
	assert.equal('model' in t, false);
	assert.equal('language' in t, false);
	assert.equal(t.wakeMode, 'phrase');
	assert.deepEqual(t.wakeWords, ['hey wall', 'computer']);
	assert.equal('extra' in t, false);
	// a patch keeps the rest
	assert.equal(normalizeSensesSettings({ mic: true }, t).nearMeters, 6);
});

test('"hey display" wakes the wall too, also for settings saved with the old two', () => {
	assert.deepEqual(DEFAULT_SENSES.wakeWords, ['hey wall', 'okay wall', 'hey display']);
	assert.deepEqual(normalizeSensesSettings({}, { wakeWords: ['hey wall', 'okay wall'] }).wakeWords, ['hey wall', 'okay wall', 'hey display']);
	// a list someone chose themselves is left alone
	assert.deepEqual(normalizeSensesSettings({ wakeWords: 'hey wall' }).wakeWords, ['hey wall']);
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
	assert.deepEqual(p, { camera: true, count: 2, distance: 1.23, x: 0.4, zone: null, posture: null, motion: 0.1, near: true, calibrated: false });
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

test('after the wall asks something back, its ears stay open for the answer', async () => {
	const { h, advance } = hub({ command: async () => ({ say: 'Should I add “Buy a kettle” to your list?', asking: true }) });
	await h.heard('command', 'buy a kettle');
	h.noteSpeaking('Should I add “Buy a kettle” to your list?');
	let res = await post(h, '/api/senses/state', {});
	const first = res.json();
	assert.ok(first.listenMs > first.hushMs, 'open past the end of the wall talking');
	assert.ok(first.listenMs - first.hushMs <= 6000);
	advance(first.listenMs + 1);
	res = await post(h, '/api/senses/state', {});
	assert.equal(res.json().listenMs, 0, 'closes on its own');
});

test('a plain answer does not keep the ears open, and the next command closes the window', async () => {
	let reply = { say: 'Done.' };
	const { h } = hub({ command: async () => reply });
	await h.heard('command', 'pause');
	assert.equal((await post(h, '/api/senses/state', {})).json().listenMs, 0);
	reply = { say: 'What kind of music?', followUp: true };
	await h.heard('command', 'put something on');
	assert.ok((await post(h, '/api/senses/state', {})).json().listenMs > 0);
	reply = { say: 'Playing jazz.' };
	await h.heard('command', 'jazz');
	assert.equal((await post(h, '/api/senses/state', {})).json().listenMs, 0);
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
	assert.deepEqual(job, { id: result.id, kind: 'face', meters: 1 });
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

test('spots: remember where you are, by name; the same name replaces, forget removes', async () => {
	const { h } = hub();
	h.handleWs({ op: 'set', patch: { camera: true } });
	await post(h, '/api/senses/state', { camera: { ok: true } });
	let { result } = h.handleWs({ op: 'remember', name: 'Bed' });
	assert.equal(result.ok, true);
	const job = (await post(h, '/api/senses/state', { camera: { ok: true } })).json().calibrate;
	assert.deepEqual(job, { id: result.id, kind: 'zone', name: 'Bed' });
	await post(h, '/api/senses/calibrated', { id: result.id, kind: 'zone', name: 'Bed', sig: [0.25, 0.7, 0.4, 0.2] });
	assert.deepEqual(h.snapshot().settings.zones, [{ name: 'Bed', sig: [0.25, 0.7, 0.4, 0.2] }]);
	({ result } = h.handleWs({ op: 'remember', name: 'bed' }));
	await post(h, '/api/senses/calibrated', { id: result.id, kind: 'zone', sig: [0.3, 0.7, 0.4, 0.2] });
	assert.equal(h.snapshot().settings.zones.length, 1, 'same name, case aside, replaces');
	({ result } = h.handleWs({ op: 'remember', name: 'Desk' }));
	await post(h, '/api/senses/calibrated', { id: result.id, error: 'no-person' });
	assert.equal(h.snapshot().calibrated.error, 'no-person');
	h.handleWs({ op: 'forget-zone', name: 'BED' });
	assert.deepEqual(h.snapshot().settings.zones, []);
	assert.equal(h.handleWs({ op: 'remember', name: '  ' }).result.error, 'no-name');
	// spots are measured, never typed in
	h.handleWs({ op: 'set', patch: { zones: [{ name: 'x', sig: [0, 0, 0, 0] }] } });
	assert.deepEqual(h.snapshot().settings.zones, []);
});

test('paper: maps the floor; a failed try keeps the old map', async () => {
	const { h } = hub();
	h.handleWs({ op: 'set', patch: { camera: true } });
	await post(h, '/api/senses/state', { camera: { ok: true } });
	const quad = [[0.45, 0.6], [0.57, 0.6], [0.6, 0.68], [0.42, 0.68]];
	const fmap = [1, 2, 3, 4, 5, 6, 7, 8, 1];
	let { result } = h.handleWs({ op: 'find-paper', paper: 'a4', wallMeters: 2.5 });
	assert.equal(result.ok, true);
	assert.deepEqual((await post(h, '/api/senses/state', {})).json().calibrate, { id: result.id, kind: 'paper', paper: 'a4', wallMeters: 2.5 });
	await post(h, '/api/senses/calibrated', { id: result.id, quad, floorMap: fmap });
	let s = h.snapshot().settings;
	assert.deepEqual([s.floorMap, s.paper, s.paperWall], [fmap, 'a4', 2.5]);
	({ result } = h.handleWs({ op: 'find-paper' }));
	await post(h, '/api/senses/calibrated', { id: result.id, floorMap: [1, 2] });
	assert.equal(h.snapshot().calibrated.error, 'no-paper');
	assert.deepEqual(h.snapshot().settings.floorMap, fmap);
	h.handleWs({ op: 'set', patch: { floorMap: null } });
	assert.equal(h.snapshot().settings.floorMap, null);
	assert.equal(h.handleWs({ op: 'find-paper', wallMeters: 99 }).result.error, 'bad-distance');
});

test('presence: spot and posture come through; with no metres, being in the room counts as near', () => {
	const p = presenceFrom({ ok: true, count: 1, distance: null, zone: 'desk', posture: 'upright' }, DEFAULT_SENSES);
	assert.deepEqual([p.zone, p.posture, p.near], ['desk', 'upright', true]);
	assert.equal(presenceFrom({ ok: true, count: 1 }, { ...DEFAULT_SENSES, look: 'face' }).near, false);
	const a = presenceFrom({ ok: true, count: 1, zone: 'desk' }, DEFAULT_SENSES);
	assert.equal(presenceChanged(a, presenceFrom({ ok: true, count: 1, zone: 'bed' }, DEFAULT_SENSES)), true);
	assert.equal(normalizeSensesSettings({ micGain: 50 }).micGain, 10);
	assert.equal(normalizeSensesSettings({}).look, 'body');
});

test('microphone settings for across the room', () => {
	const d = normalizeSensesSettings({});
	assert.deepEqual([d.hearFrom, d.noiseSuppress, d.voiceBoost], ['room', 'light', true]);
	const t = normalizeSensesSettings({ hearFrom: 'near', noiseSuppress: 'loud', voiceBoost: false });
	assert.deepEqual([t.hearFrom, t.noiseSuppress, t.voiceBoost], ['near', 'light', false]);
});

test('presence changes reach onPresence with what came before (getting up is the morning wake)', async () => {
	const seen = [];
	const { h } = hub({ onPresence: (now, before) => seen.push([before.posture, now.posture]) });
	h.handleWs({ op: 'set', patch: { camera: true } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, posture: 'lying' } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, posture: 'upright' } });
	assert.deepEqual(seen.at(-1), ['lying', 'upright']);
});

/* ---------- places ---------- */

const SIG = [0.5, 0.5, 0.2, 0.4];
const roomWith = (places, extra = {}) =>
	normalizeSensesSettings({ camera: true, look: 'body', zones: [{ name: 'bed', sig: SIG }, { name: 'Desk', sig: SIG }], places, ...extra });
const at = (zone, posture = 'upright') => ({ camera: true, count: 1, zone, posture });

test('places: only known spots and pages are kept; empty rules drop off', () => {
	const s = roomWith({ desk: { view: 'agents' }, bed: { view: 'nope', lieOff: true }, attic: { view: 'music' }, Desk2: {} });
	assert.deepEqual(s.places, { Desk: { view: 'agents', lieOff: false }, bed: { view: '', lieOff: true } });
	assert.equal(normalizeSensesSettings({ awayMinutes: 7 }).awayMinutes, 0);
	assert.equal(normalizeSensesSettings({ awayMinutes: 30 }).awayMinutes, 30);
});

test('places: settling in a spot shows its page once, after a dwell', () => {
	const settings = roomWith({ desk: { view: 'agents' } });
	const st = newPlaceState();
	assert.deepEqual(placeStep(st, { presence: at('Desk'), settings, now: 0 }), []);
	assert.deepEqual(placeStep(st, { presence: at('Desk'), settings, now: 5000 }), []);
	assert.deepEqual(placeStep(st, { presence: at('Desk'), settings, now: 9000 }), [{ navigate: 'agents', zone: 'Desk' }]);
	assert.deepEqual(placeStep(st, { presence: at('Desk'), settings, now: 60000 }), []);
	// passing through another spot and back counts as arriving again
	placeStep(st, { presence: at('bed'), settings, now: 61000 });
	placeStep(st, { presence: at('Desk'), settings, now: 62000 });
	assert.deepEqual(placeStep(st, { presence: at('Desk'), settings, now: 71000 }), [{ navigate: 'agents', zone: 'Desk' }]);
});

test('places: a page picked by hand holds off the spots for a while', () => {
	const settings = roomWith({ desk: { view: 'agents' } });
	const st = newPlaceState();
	st.manualAt = 0;
	placeStep(st, { presence: at('Desk'), settings, now: 1000 });
	assert.deepEqual(placeStep(st, { presence: at('Desk'), settings, now: 20000 }), []);
});

test('places: lying in a screen-off spot turns the panel off only at night, once', () => {
	const settings = roomWith({ bed: { lieOff: true } });
	const day = newPlaceState();
	placeStep(day, { presence: at('bed', 'lying'), settings, now: 0 });
	assert.deepEqual(placeStep(day, { presence: at('bed', 'lying'), settings, now: 120000 }), []);
	const night = newPlaceState();
	placeStep(night, { presence: at('bed', 'lying'), settings, now: 0, quiet: true });
	assert.deepEqual(placeStep(night, { presence: at('bed', 'lying'), settings, now: 30000, quiet: true }), []);
	assert.deepEqual(placeStep(night, { presence: at('bed', 'lying'), settings, now: 61000, quiet: true }), [{ panel: 'off', reason: 'asleep' }]);
	assert.deepEqual(placeStep(night, { presence: at('bed', 'lying'), settings, now: 200000, quiet: true }), []);
});

test('places: nobody home turns the panel off once per absence, and never without a camera', () => {
	const settings = roomWith({}, { awayMinutes: 10 });
	const st = newPlaceState();
	const empty = { camera: true, count: 0 };
	placeStep(st, { presence: empty, settings, now: 0 });
	assert.deepEqual(placeStep(st, { presence: empty, settings, now: 9 * 60000 }), []);
	assert.deepEqual(placeStep(st, { presence: empty, settings, now: 10 * 60000 }), [{ panel: 'off', reason: 'away' }]);
	assert.deepEqual(placeStep(st, { presence: empty, settings, now: 20 * 60000 }), []);
	placeStep(st, { presence: at(null), settings, now: 21 * 60000 });
	placeStep(st, { presence: empty, settings, now: 22 * 60000 });
	assert.deepEqual(placeStep(st, { presence: empty, settings, now: 32 * 60000 }), [{ panel: 'off', reason: 'away' }]);
	assert.deepEqual(placeStep(newPlaceState(), { presence: { camera: false, count: 0 }, settings, now: 1e9 }), []);
});

test('places: walking out on the door side turns the screen off soon; back in turns it on', () => {
	const settings = normalizeSensesSettings({ camera: true, exitSide: 'left', exitSeconds: 20, awayMinutes: 10 });
	const st = newPlaceState();
	const seen = (x) => ({ camera: true, count: 1, x });
	const empty = { camera: true, count: 0 };
	placeStep(st, { presence: seen(0.1), settings, now: 0 });
	placeStep(st, { presence: seen(-0.7), settings, now: 1000 });
	placeStep(st, { presence: empty, settings, now: 2000 });
	assert.deepEqual(placeStep(st, { presence: empty, settings, now: 21000 }), [], 'a short gap is the camera blinking, not you leaving');
	assert.deepEqual(placeStep(st, { presence: empty, settings, now: 22000 }), [{ panel: 'off', reason: 'left-room', side: 'left' }]);
	// the away timer doesn't turn it off a second time
	assert.deepEqual(placeStep(st, { presence: empty, settings, now: 12 * 60000 }), []);
	assert.deepEqual(placeStep(st, { presence: seen(-0.9), settings, now: 13 * 60000 }), [{ panel: 'on', reason: 'back' }]);
	assert.deepEqual(placeStep(st, { presence: seen(-0.5), settings, now: 13 * 60000 + 1000 }), []);
});

test('places: vanishing mid-picture, or out the other side, waits for the away timer', () => {
	const settings = normalizeSensesSettings({ camera: true, exitSide: 'left', awayMinutes: 10 });
	const empty = { camera: true, count: 0 };
	for (const x of [0, 0.8]) {
		const st = newPlaceState();
		placeStep(st, { presence: { camera: true, count: 1, x }, settings, now: 0 });
		placeStep(st, { presence: empty, settings, now: 1000 });
		assert.deepEqual(placeStep(st, { presence: empty, settings, now: 5 * 60000 }), []);
		assert.deepEqual(placeStep(st, { presence: empty, settings, now: 11 * 60000 }), [{ panel: 'off', reason: 'away' }]);
	}
	const either = normalizeSensesSettings({ camera: true, exitSide: 'either', exitSeconds: 10 });
	const st = newPlaceState();
	placeStep(st, { presence: { camera: true, count: 1, x: 0.8 }, settings: either, now: 0 });
	placeStep(st, { presence: empty, settings: either, now: 1000 });
	assert.deepEqual(placeStep(st, { presence: empty, settings: either, now: 11000 }), [{ panel: 'off', reason: 'left-room', side: 'right' }]);
});

test('places: coming back only wakes a screen the camera turned off, and can be turned off', () => {
	const settings = normalizeSensesSettings({ camera: true, exitSide: 'right', exitSeconds: 10, wakeOnReturn: false });
	const st = newPlaceState();
	placeStep(st, { presence: { camera: true, count: 1, x: 0.9 }, settings, now: 0 });
	placeStep(st, { presence: { camera: true, count: 0 }, settings, now: 1000 });
	assert.equal(placeStep(st, { presence: { camera: true, count: 0 }, settings, now: 12000 }).length, 1);
	assert.deepEqual(placeStep(st, { presence: { camera: true, count: 1, x: 0.9 }, settings, now: 20000 }), []);
	// nothing turned off: nothing to turn back on
	const plain = newPlaceState();
	placeStep(plain, { presence: { camera: true, count: 0 }, settings: normalizeSensesSettings({}), now: 0 });
	assert.deepEqual(placeStep(plain, { presence: { camera: true, count: 1 }, settings: normalizeSensesSettings({}), now: 1000 }), []);
});

test('exit side and its settings', () => {
	assert.equal(exitSideOf(-0.6), 'left');
	assert.equal(exitSideOf(0.5), 'right');
	assert.equal(exitSideOf(0.2), 'middle');
	assert.equal(exitSideOf(null), 'middle');
	const d = normalizeSensesSettings({});
	assert.deepEqual([d.exitSide, d.exitSeconds, d.wakeOnReturn], ['off', 20, true]);
	const bad = normalizeSensesSettings({ exitSide: 'up', exitSeconds: 7, wakeOnReturn: 0 });
	assert.deepEqual([bad.exitSide, bad.exitSeconds, bad.wakeOnReturn], ['off', 20, true]);
	assert.equal(normalizeSensesSettings({ wakeOnReturn: false }).wakeOnReturn, false);
});

test('hub: a spot asks for its page; picking one by hand holds it off', async () => {
	const acts = [];
	const { h, advance } = hub({ onPlace: (a) => acts.push(a) });
	h.setSettings({ camera: true, look: 'body', zones: [{ name: 'desk', sig: SIG }], places: { desk: { view: 'music' } } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, zone: 'desk', posture: 'upright' } });
	advance(4000);
	h.tick();
	assert.deepEqual(acts, []);
	advance(4500);
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, zone: 'desk', posture: 'upright' } });
	h.tick();
	assert.deepEqual(acts, [{ navigate: 'music', zone: 'desk' }]);
	h.noteManual();
	// forgetting the spot forgets its rule
	h.handleWs({ op: 'forget-zone', name: 'desk' });
	assert.deepEqual(h.snapshot().settings.places, {});
});

/* ---------- "that was wrong" ---------- */

test('report: the phone asks, the process sends its last 30 s, the wall keeps both sides', async () => {
	const { h, dataDir, advance } = hub();
	h.handleWs({ op: 'set', patch: { camera: true } });
	await post(h, '/api/senses/state', { camera: { ok: true, count: 1, zone: 'bed', posture: 'lying' } });
	advance(1000);
	const r = h.handleWs({ op: 'report', note: 'it lost me in bed' }).result;
	assert.equal(r.ok, true);
	assert.equal(h.handleWs({ op: 'report' }).result.error, 'busy');
	const reply = JSON.parse((await post(h, '/api/senses/state', { camera: { ok: true, count: 0 } })).body);
	assert.equal(reply.report, r.id);
	// a wrong id is ignored
	await post(h, '/api/senses/report', { id: 'nope', rows: [] });
	assert.equal(h.snapshot().reporting, true);
	await post(h, '/api/senses/report', { id: r.id, rows: [{ t: 1, kind: 'camera', count: 0 }] });
	const snap = h.snapshot();
	assert.equal(snap.reporting, false);
	assert.equal(snap.reported.ok, true);
	const files = readdirSync(path.join(dataDir, 'senses-reports'));
	assert.deepEqual(h.handleWs({ op: 'reports' }).reports, files);
	const doc = JSON.parse(h.handleWs({ op: 'report-read', name: files[0] }).report.text);
	assert.equal(doc.note, 'it lost me in bed');
	assert.deepEqual(doc.process, [{ t: 1, kind: 'camera', count: 0 }]);
	assert.equal(doc.presence[0].zone, 'bed');
	assert.equal(doc.presence[0].secondsBefore, 1);
	assert.equal(h.handleWs({ op: 'report-read', name: '../senses.json' }).result.error, 'not-found');
});

test('report: without the process, or when it never answers, the wall saves its own side', async () => {
	const { h, dataDir, advance } = hub();
	assert.equal(h.handleWs({ op: 'report' }).result.ok, true);
	assert.equal(h.snapshot().reported.error, 'senses-offline');
	await post(h, '/api/senses/state', { camera: { ok: false } });
	advance(1000);
	h.handleWs({ op: 'report' });
	advance(11000);
	h.tick();
	assert.equal(h.snapshot().reported.error, 'no-answer');
	assert.equal(readdirSync(path.join(dataDir, 'senses-reports')).length >= 1, true);
	// only a paired phone may ask
	assert.equal(h.handleWs({ op: 'report' }, { mayChange: false }).result.error, 'not-paired');
});
