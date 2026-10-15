import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { buildLedger, ledgerLine, sameLedger } from '../src/lib/ledger.js';
import { createLedgerHub } from '../src/lib/server/ledgerHub.js';

const NOW = Date.parse('2026-10-15T14:00:00Z');
const iso = (minutes) => new Date(NOW + minutes * 60_000).toISOString();

const tasks = [
	{ id: 'bins', title: 'Take out the bins', kind: 'chore', status: 'overdue', nextDue: iso(-30), source: '' },
	{ id: 'cat', title: 'Feed the cat', kind: 'chore', status: 'today', nextDue: iso(120) },
	{ id: 'far', title: 'Renew passport', kind: 'chore', status: 'upcoming', nextDue: iso(60 * 24 * 10) },
	{ id: 'old', title: 'Water plants', kind: 'chore', status: 'done', nextDue: null },
	{ id: 'hw1', title: 'Physics lab #hw', kind: 'alert', status: 'today', nextDue: iso(300), external: true, allDay: true, source: 'Google Calendar' }
];

test('sorts facts into now, soon and past', () => {
	const l = buildLedger({
		tasks,
		approvals: [{ id: 'p1', source: 'Claude Code', title: 'Run npm test?', detail: 'npm test', status: 'pending', createdAt: iso(-1), expiresAt: iso(2) }],
		alerts: [
			{ id: 'w1', event: 'Tornado Warning', headline: 'Take shelter', tier: 'warning', expires: iso(30) },
			{ id: 'a1', event: 'Heat Advisory', tier: 'advisory', expires: iso(600) },
			{ id: 'gone', event: 'Flood Watch', tier: 'watch', expires: iso(-5) }
		],
		day: {
			chores: [{ title: 'Make bed', at: iso(-300) }],
			tracks: [{ title: 'Holocene', artist: 'Bon Iver', at: iso(-20) }],
			agents: [{ source: 'Cursor', at: iso(-60) }]
		},
		now: NOW
	});
	assert.deepEqual(l.now.map((e) => e.id), ['nws:w1', 'approval:p1', 'task:bins']);
	assert.deepEqual(l.soon.map((e) => e.id), ['task:cat', 'task:hw1', 'nws:a1']);
	assert.equal(l.soon.find((e) => e.id === 'task:hw1').kind, 'homework');
	assert.deepEqual(l.past.map((e) => e.kind), ['track', 'agent', 'done'], 'newest first');
	assert.deepEqual(l.counts, { now: 3, calling: 0, soon: 3, past: 3 });
	assert.deepEqual(l.now.find((e) => e.kind === 'approval').actions, ['allow', 'deny']);
});

test('a ringing fact is one entry, marked calling and answerable', () => {
	const l = buildLedger({
		tasks,
		attention: [
			{ id: 'a7', kind: 'chore', title: 'Take out the bins', ref: 'task:bins', raisedAt: iso(-2) },
			{ id: 'a8', kind: 'timer', title: 'Timer done', body: 'Pasta', ref: 'task:timer9', raisedAt: iso(-1) }
		],
		now: NOW
	});
	const bins = l.now.filter((e) => e.title === 'Take out the bins');
	assert.equal(bins.length, 1, 'no duplicate for the attention item');
	assert.deepEqual(bins[0].calling, { id: 'a7', kind: 'chore', since: iso(-2) });
	assert.deepEqual(bins[0].actions, ['ack', 'done', 'snooze']);
	const timer = l.now.find((e) => e.id === 'task:timer9');
	assert.equal(timer.status, 'ringing', 'a timer that already fired stands on its own');
	assert.equal(l.counts.calling, 2);
	assert.equal(l.now[0].kind, 'timer', 'ringing timers come before ringing chores');
});

test('ledgerLine and sameLedger', () => {
	const a = buildLedger({ tasks, now: NOW });
	assert.equal(ledgerLine(a), '1 needs you: Take out the bins. 2 coming up.');
	assert.equal(ledgerLine(buildLedger({ now: NOW })), 'Nothing needs you.');
	assert.ok(sameLedger(a, buildLedger({ tasks, now: NOW + 1000 })), 'only the timestamp moved');
	assert.ok(!sameLedger(a, buildLedger({ tasks: tasks.slice(1), now: NOW })));
});

test('the hub broadcasts only real changes and serves /api/ledger', async () => {
	let list = tasks;
	const sent = [];
	const hub = createLedgerHub({ sources: () => ({ tasks: list }), broadcast: (m) => sent.push(m), now: () => NOW, debounceMs: 1 });
	assert.equal(hub.refresh(), true);
	assert.equal(hub.refresh(), false, 'unchanged');
	list = tasks.slice(1);
	hub.changed();
	hub.changed();
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(sent.length, 2, 'two bursts, two messages');
	assert.equal(sent[1].ledger.now.length, 0);

	const server = createServer(async (req, res) => {
		if (!(await hub.handleHttp(req, res))) (res.writeHead(404), res.end());
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		const json = await (await fetch(`${base}/api/ledger`)).json();
		assert.equal(json.soon[0].title, 'Feed the cat');
		assert.equal(await (await fetch(`${base}/api/ledger?format=text`)).text(), '2 coming up.');
	} finally {
		hub.stop();
		await new Promise((r) => server.close(r));
	}
});
