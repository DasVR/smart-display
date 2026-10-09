import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildReceipt, dayKey, logEvent, KEEP_DAYS } from '../src/lib/dayLog.js';
import { createDayLogHub } from '../src/lib/server/dayLogHub.js';

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

test('logs the day and prints it as a receipt', () => {
	let log = { days: {} };
	log = logEvent(log, 'chore', { title: 'Feed the cat' }, at(9, 7, 12));
	log = logEvent(log, 'chore', { title: 'Bins out' }, at(9, 18, 40));
	log = logEvent(log, 'alert', { title: 'Leave' }, at(9, 7, 40));
	log = logEvent(log, 'track', { title: 'Motion Sickness', artist: 'Phoebe Bridgers' }, at(9, 16));
	const same = logEvent(log, 'track', { title: 'Motion Sickness', artist: 'Phoebe Bridgers' }, at(9, 16, 1));
	assert.equal(same, log, 'the same song polled twice counts once');
	log = logEvent(log, 'track', { title: 'Kyoto', artist: 'Phoebe Bridgers' }, at(9, 16, 4));
	log = logEvent(log, 'agent', { source: 'Claude Code' }, at(9, 13));
	log = logEvent(log, 'agent', { source: 'Claude Code' }, at(9, 15));
	log = logEvent(log, 'agent', { source: 'Cursor' }, at(9, 17));
	log = logEvent(log, 'approval', { decision: 'allow' }, at(9, 13, 2));
	log = logEvent(log, 'approval', { decision: 'maybe' }, at(9, 13, 3));
	assert.equal(logEvent(log, 'nonsense', {}, at(9, 14)), log);

	const r = buildReceipt(log, { now: at(9, 22), weather: { high: 71.6, low: 50.2 } });
	assert.equal(r.dateText, 'FRI, OCT 9, 2026');
	assert.deepEqual(
		r.lines.map((l) => [l.sub ? '  ' + l.label : l.label, l.qty]),
		[
			['Chores done', 2],
			['  Feed the cat', '7:12a'],
			['  Bins out', '6:40p'],
			['Alerts', 1],
			['Songs played', 2],
			['  Most: Phoebe Bridgers', '×2'],
			['Agent runs', 3],
			['  Claude Code 2 · Cursor 1', ''],
			['Allowed / denied', '1/0'],
			['High / low', '72° / 50°']
		]
	);
	assert.equal(r.total, 9);
	assert.equal(r.signoff, 'Busy day. Well earned.');
	assert.equal(buildReceipt(log, { now: at(10, 22) }).signoff, 'A quiet one. Rest up.', 'a new day starts empty');
});

test('keeps a week at most', () => {
	let log = { days: {} };
	for (let d = 1; d <= 10; d++) log = logEvent(log, 'alert', {}, at(d, 12));
	assert.equal(Object.keys(log.days).length, KEEP_DAYS);
	assert.ok(!log.days[dayKey(at(1, 12))], 'oldest dropped');
});

test('the hub serves /api/day and saves on flush', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'day-'));
	const hub = createDayLogHub({ dataDir, now: () => at(9, 20), log: { error() {} } });
	hub.record('chore', { title: 'Water plants' });
	hub.flush();
	const saved = JSON.parse(readFileSync(path.join(dataDir, 'daylog.json'), 'utf8'));
	assert.equal(saved.days['2026-10-09'].chores[0].title, 'Water plants');

	const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
	assert.equal(await hub.handleHttp({ method: 'GET', url: '/api/day' }, res), true);
	assert.equal(JSON.parse(res.body).lines[0].qty, 1);
	assert.equal(await hub.handleHttp({ method: 'GET', url: '/api/day?date=nope' }, res), true);
	assert.equal(res.status, 400);
	assert.equal(await hub.handleHttp({ method: 'GET', url: '/api/days' }, res), false);
});
