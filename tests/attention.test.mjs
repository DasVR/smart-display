import test from 'node:test';
import assert from 'node:assert/strict';
import { ACK_RE, POLICIES, attentionKindFor, boostFor, nextSound, shouldWake, sortAttention, soundTimes } from '../src/lib/attention.js';
import { createAttentionHub } from '../src/lib/server/attentionHub.js';
import { buildMenu } from '../src/lib/wallActions.js';

const quiet = { log() {}, warn() {}, error() {} };
const T0 = Date.UTC(2026, 9, 11, 15, 0, 0);
const at = (s) => T0 + s * 1000;

test('which moments need attention', () => {
	assert.equal(attentionKindFor({ kind: 'alert', title: 'Timer: Pasta' }), 'timer');
	assert.equal(attentionKindFor({ kind: 'alert', title: 'Call mom' }), 'reminder');
	assert.equal(attentionKindFor({ kind: 'approval' }), 'approval');
	assert.equal(attentionKindFor({ kind: 'severe-weather' }), 'severe');
	assert.equal(attentionKindFor({ kind: 'chore' }), 'chore');
	for (const kind of ['done', 'working', 'volume', 'speak', 'music', 'briefing', '']) assert.equal(attentionKindFor({ kind }), null, kind);
});

test('how hard each one tries', () => {
	// a timer keeps going; a chore nudges once more and stops
	assert.deepEqual(soundTimes(POLICIES.chore), [0, 300]);
	const timer = soundTimes(POLICIES.timer);
	assert.deepEqual(timer.slice(0, 7), [0, 6, 12, 18, 30, 45, 60]);
	assert.equal(timer.at(-1) <= POLICIES.timer.soundFor, true);
	assert.ok(timer.includes(90) && timer.includes(600));

	assert.equal(shouldWake('timer', { quiet: true }), true, 'a timer you set rings even at night');
	assert.equal(shouldWake('severe', { quiet: true }), true);
	assert.equal(shouldWake('reminder', { quiet: false }), true);
	assert.equal(shouldWake('reminder', { quiet: true }), false, 'reminders wait for morning');
	assert.equal(shouldWake('approval', { quiet: true }), false);
	assert.equal(shouldWake('chore', { quiet: false }), false, 'chores never wake the panel');

	assert.equal(boostFor(0), 1);
	assert.equal(boostFor(1), 1.2);
	assert.equal(boostFor(50), 2, 'never more than twice as loud');
});

test('repeats: on time, never a backlog, silent at night unless urgent', () => {
	const item = { kind: 'timer', raisedAt: new Date(T0).toISOString() };
	assert.equal(nextSound(item, at(0), 0), 0, 'the first one');
	assert.equal(nextSound(item, at(3), 1), -1, 'not yet');
	assert.equal(nextSound(item, at(6), 1), 1, 'the first repeat');
	assert.equal(nextSound(item, at(6.5), 2), -1, 'not twice');
	assert.equal(nextSound(item, at(40), 2), 4, 'away for a while: just the latest one, no catch-up burst');
	assert.equal(nextSound({ ...item, acked: true }, at(6), 1), -1);
	assert.equal(nextSound(item, at(1000), 0) >= 0, true);
	assert.equal(nextSound(item, at(6), 1, { quiet: true }), 1, 'timers ring in quiet hours');
	const reminder = { kind: 'reminder', raisedAt: new Date(T0).toISOString() };
	assert.equal(nextSound(reminder, at(30), 1, { quiet: true }), -1, 'reminders stay silent in quiet hours');
	assert.equal(nextSound(reminder, at(30), 1), 1);
	assert.equal(nextSound(reminder, at(10000), 4), -1, 'reminders give up after their last repeat');
});

test('ordering and "got it"', () => {
	const items = [
		{ id: 'c', level: 'gentle', raisedAt: new Date(at(5)).toISOString() },
		{ id: 'r', level: 'important', raisedAt: new Date(at(1)).toISOString() },
		{ id: 't', level: 'urgent', raisedAt: new Date(at(0)).toISOString() },
		{ id: 't2', level: 'urgent', raisedAt: new Date(at(2)).toISOString() }
	];
	assert.deepEqual(sortAttention(items).map((i) => i.id), ['t2', 't', 'r', 'c']);
	for (const yes of ['got it', 'okay', 'ok', 'thanks', 'stop the timer', 'stop ringing', 'dismiss', 'quiet', 'shh', 'I heard you']) assert.ok(ACK_RE.test(yes), yes);
	for (const no of ['stop the music', 'okay remind me later', 'quiet hours', 'got it done by friday']) assert.ok(!ACK_RE.test(no), no);
});

function hub(opts = {}) {
	const sent = [];
	const calls = [];
	let t = T0;
	const h = createAttentionHub({
		broadcast: (m) => sent.push(m),
		now: () => t,
		isQuiet: () => Boolean(opts.quiet),
		wake: async () => (calls.push('wake'), opts.wasOff ?? true),
		restore: async () => calls.push('restore'),
		restoreMs: 20,
		log: quiet
	});
	return { h, sent, calls, tick: (s) => (t += s * 1000) };
}

test('raising: wakes the panel for what matters, once per thing', async () => {
	const { h, sent, calls } = hub();
	const a = h.fromNotify({ type: 'notify', kind: 'alert', title: 'Timer: Pasta', taskId: 't1' });
	assert.equal(a.kind, 'timer');
	assert.equal(a.level, 'urgent');
	assert.equal(a.sound, 'timer');
	assert.equal(a.ref, 'task:t1');
	await h.awake();
	assert.deepEqual(calls, ['wake']);
	assert.equal(sent.at(-1).type, 'attention');
	assert.equal(sent.at(-1).items.length, 1);

	assert.equal(h.fromNotify({ kind: 'alert', title: 'Timer: Pasta', taskId: 't1' }).id, a.id, 'the same thing is never raised twice');
	assert.equal(h.count(), 1);

	h.fromNotify({ kind: 'chore', title: 'Feed the cat', taskId: 'c1' });
	await h.awake();
	assert.deepEqual(calls, ['wake'], 'a chore never wakes the panel');
	assert.equal(h.fromNotify({ kind: 'done', title: 'Claude finished' }), null, 'ambient things stay ambient');
	assert.equal(h.snapshot()[0].kind, 'timer', 'urgent first');
	h.stop();
});

test('quiet hours: timers still wake it, reminders wait', async () => {
	const { h, calls } = hub({ quiet: true });
	h.fromNotify({ kind: 'alert', title: 'Call mom', taskId: 'r1' });
	await h.awake();
	assert.deepEqual(calls, []);
	assert.equal(h.snapshot()[0].quiet, true, 'the wall knows to keep it silent');
	h.fromNotify({ kind: 'alert', title: 'Timer', taskId: 't1' });
	await h.awake();
	assert.deepEqual(calls, ['wake']);
	h.stop();
});

test('answering, and settling on its own', async () => {
	const { h } = hub();
	h.fromNotify({ kind: 'chore', title: 'Feed the cat', taskId: 'c1' });
	h.fromNotify({ kind: 'approval', title: 'Claude needs you', approvalId: 'p1' });
	h.fromNotify({ kind: 'alert', title: 'Call mom', taskId: 'r1' });
	assert.equal(h.count(), 3);

	// the chore is ticked off (or snoozed): it goes
	h.syncTasks([{ id: 'c1', status: 'upcoming' }, { id: 'r1', status: 'done' }]);
	assert.deepEqual(h.snapshot().map((i) => i.kind).sort(), ['approval', 'reminder'], 'alerts do not follow the list; they are done the moment they fire');
	// the approval is answered
	h.syncApprovals([]);
	assert.deepEqual(h.snapshot().map((i) => i.kind), ['reminder']);
	// "got it"
	assert.equal(h.ack(h.snapshot()[0].id), 1);
	assert.equal(h.count(), 0);
	assert.equal(h.ack(), 0);
	h.stop();
});

test('a panel it woke goes back off afterwards, unless someone touched it', async () => {
	const one = hub();
	one.h.fromNotify({ kind: 'alert', title: 'Timer', taskId: 't1' });
	await one.h.awake();
	one.h.ack();
	await new Promise((r) => setTimeout(r, 40));
	assert.deepEqual(one.calls, ['wake', 'restore']);

	const two = hub();
	two.h.fromNotify({ kind: 'alert', title: 'Timer', taskId: 't1' });
	await two.h.awake();
	two.h.panelChanged(); // someone turned it on (or off) by hand
	two.h.ack();
	await new Promise((r) => setTimeout(r, 40));
	assert.deepEqual(two.calls, ['wake'], 'theirs now: left alone');

	const three = hub({ wasOff: false });
	three.h.fromNotify({ kind: 'alert', title: 'Timer', taskId: 't1' });
	await three.h.awake();
	three.h.ack();
	await new Promise((r) => setTimeout(r, 40));
	assert.deepEqual(three.calls, ['wake'], 'it was already on: nothing to restore');
});

test('the Action button menu leads with "Got it"', () => {
	const items = buildMenu({ attention: [{ id: 'a1', title: 'Timer: Pasta', kind: 'timer' }] });
	assert.equal(items[0].label, 'Got it: Timer: Pasta');
	assert.equal(items[0].intent, 'ack');
	assert.equal(buildMenu({})[0].id, 'dictate');
});

test('end to end: a timer comes due, the Action button and "stop" answer it', async () => {
	const { createServer } = await import('node:http');
	const { mkdtempSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const path = await import('node:path');
	const { createTaskHub } = await import('../src/lib/server/taskHub.js');
	const { createApprovalHub } = await import('../src/lib/server/approvalHub.js');
	const { createActionHub } = await import('../src/lib/server/actionHub.js');

	const dataDir = mkdtempSync(path.join(tmpdir(), 'att-'));
	let t = Date.UTC(2026, 9, 11, 15, 0);
	const att = createAttentionHub({ now: () => t, log: quiet, restoreMs: 10 });
	const tap = (msg) => {
		if (msg?.type === 'notify') att.fromNotify(msg);
		else if (msg?.type === 'tasks') att.syncTasks(msg.tasks);
	};
	let actionHub;
	const calls = [];
	const taskHub = createTaskHub({ dataDir, broadcast: tap, log: quiet, now: () => t, env: {}, commands: (x) => actionHub.command(x) });
	const approvalHub = createApprovalHub({ dataDir, broadcast: () => {}, log: quiet, now: () => t, env: {} });
	actionHub = createActionHub({
		dataDir,
		taskHub,
		approvalHub,
		now: () => t,
		env: {},
		log: quiet,
		getState: () => ({ nowPlaying: { playing: true, title: 'Kyoto' }, view: 'clock', hdmi: 'on' }),
		player: async (a) => (calls.push(a), { ok: true }),
		attention: { list: () => att.snapshot(), ack: (id) => att.ack(id) }
	});
	const server = createServer(async (req, res) => {
		if (await taskHub.handleHttp(req, res)) return;
		if (await actionHub.handleHttp(req, res)) return;
		res.writeHead(404);
		res.end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const say = async (x) => (await fetch(`${base}/api/tasks/say?format=text`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: x })).text();
	try {
		const due = () => {
			t += 61000;
			taskHub.tick();
		};
		assert.match(await say('set a pasta timer for 1 minute'), /timer/i);
		due();
		assert.equal(att.snapshot()[0]?.kind, 'timer', 'the due timer is ringing');

		// one press of the Action button stops it, before anything else
		assert.equal(await (await fetch(`${base}/api/action?format=text`, { method: 'POST' })).text(), 'Okay. Timer: Pasta acknowledged.');
		assert.equal(att.count(), 0);

		// a bare "stop" stops the ringing first, and pauses the music only when nothing rings
		await say('set a timer for 1 minute');
		due();
		assert.equal(att.count(), 1);
		assert.equal(await say('stop'), 'Okay. Timer acknowledged.');
		assert.deepEqual(calls, [], 'the music was left alone');
		assert.equal(await say('stop'), 'Paused.');
		assert.deepEqual(calls, ['pause']);

		await say('set a timer for 1 minute');
		due();
		assert.equal(await say('okay, got it'), 'Okay. Timer acknowledged.');
		assert.equal(await say('got it'), 'Nothing is calling for you.', 'never a chore called "Got it"');
		assert.equal(await say('thanks'), 'Nothing is calling for you.');
		assert.equal(taskHub.snapshot().some((x) => /got it|thanks/i.test(x.title)), false);
	} finally {
		server.close();
		approvalHub.stop();
		taskHub.stop?.();
		att.stop();
	}
});
