import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { logLine, parseLog, redact, replayPlan, stateAt } from '../src/lib/eventLog.js';
import { createEventLog } from '../src/lib/server/eventLog.js';

test('redact keeps state and drops what must never be written', () => {
	assert.equal(redact({ type: 'pair-code', code: '123456' }), null);
	assert.equal(redact({ type: 'audioSpectrum', bins: [1, 2] }), null);
	assert.equal(redact({ type: 'nowPlaying', kind: 'update', position: 3 }), null);
	assert.deepEqual(redact({ type: 'heard', text: 'my bank PIN is 1234', from: 'mic' }), { type: 'heard', from: 'mic' });
	assert.deepEqual(redact({ type: 'speak', url: '/api/voice/clip/x', text: 'Dinner', source: 'Reminder' }), { type: 'speak', source: 'Reminder' });
	const np = redact({ type: 'nowPlaying', kind: 'track', title: 'Holocene', lyrics: { lines: [1, 2, 3] } });
	assert.equal(np.title, 'Holocene');
	assert.equal('lyrics' in np, false);
	const init = redact({ type: 'init', pairing: { device: 'x' }, senses: { presence: { count: 1 }, settings: { zones: [] }, online: true }, notes: { on: true, count: 4, lines: ['secret'] } });
	assert.deepEqual(init, { type: 'init', senses: { presence: { count: 1 }, online: true }, notes: { on: true, count: 4 } });
	assert.equal(redact({ type: 'notify', body: 'x'.repeat(1000) }).body.length, 400);
	assert.equal(redact(null), null);
	assert.equal(logLine({ type: 'ping' }), '');
});

test('parseLog, stateAt and replayPlan', () => {
	const t0 = Date.parse('2026-10-15T11:00:00Z');
	const text = [
		logLine({ type: 'init', view: 'clock', tasks: [{ id: 'a' }] }, t0),
		logLine({ type: 'tasks', tasks: [{ id: 'a' }, { id: 'b' }] }, t0 + 60_000),
		logLine({ type: 'navigate', view: 'music' }, t0 + 120_000),
		'{"t": broken\n',
		logLine({ type: 'notify', title: 'Done' }, t0 + 180_000)
	].join('');
	const entries = parseLog(text);
	assert.equal(entries.length, 4, 'the broken line is skipped');
	const s = stateAt(entries, t0 + 130_000);
	assert.equal(s.type, 'init');
	assert.equal(s.view, 'music');
	assert.deepEqual(s.tasks.map((x) => x.id), ['a', 'b']);
	assert.equal(stateAt(entries, t0).view, 'clock');

	const plan = replayPlan(entries, { from: t0 + 60_000, speed: 60 });
	assert.deepEqual(plan.map((p) => [p.delay, p.msg.type]), [[0, 'tasks'], [1000, 'navigate'], [2000, 'notify']]);
	assert.deepEqual(replayPlan(entries, { to: t0 + 90_000 }).map((p) => p.msg.type), ['tasks'], 'keyframes are not replayed');
	assert.deepEqual(replayPlan([], {}), []);
});

test('the server log appends per day, serves only locally and prunes old days', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'evlog-'));
	writeFileSync(path.join(dir, '2026-09-01.ndjson'), '');
	let now = Date.parse('2026-10-15T15:00:00');
	let local = true;
	const ev = createEventLog({ dir, now: () => now, flushMs: 5, env: {}, isLocal: () => local, log: { error() {} } });
	ev.record({ type: 'tasks', tasks: [] });
	ev.record({ type: 'ping' });
	ev.keyframe({ view: 'clock' });
	await ev.flush();
	const lines = parseLog(readFileSync(path.join(dir, '2026-10-15.ndjson'), 'utf8'));
	assert.deepEqual(lines.map((l) => l.m.type), ['tasks', 'init']);
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(existsSync(path.join(dir, '2026-09-01.ndjson')), false, 'older than 14 days');

	now = Date.parse('2026-10-16T00:00:01');
	ev.record({ type: 'navigate', view: 'music' });
	await ev.flush();
	assert.ok(existsSync(path.join(dir, '2026-10-16.ndjson')), 'a new day, a new file');

	const server = createServer(async (req, res) => {
		if (!(await ev.handleHttp(req, res))) (res.writeHead(404), res.end());
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		assert.deepEqual((await (await fetch(`${base}/api/log`)).json()).days, ['2026-10-16', '2026-10-15']);
		assert.match(await (await fetch(`${base}/api/log/2026-10-15`)).text(), /"type":"tasks"/);
		assert.equal((await fetch(`${base}/api/log/2026-01-01`)).status, 404);
		assert.equal((await fetch(`${base}/api/log/../../etc`)).status, 404);
		local = false;
		assert.equal((await fetch(`${base}/api/log`)).status, 403);
	} finally {
		await new Promise((r) => server.close(r));
	}

	const off = createEventLog({ dir: path.join(dir, 'off'), env: { EVENT_LOG: 'off' } });
	off.record({ type: 'tasks', tasks: [] });
	await off.flush();
	assert.equal(existsSync(path.join(dir, 'off')), false);
});
