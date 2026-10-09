// The wall reads calendar days on its own clock (America/New_York), like the kiosk.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { calendarToItems, eventDate, eventDayKey, isAllDay, wallDayKey } from '../src/lib/calendarItems.js';
import { createTaskHub } from '../src/lib/server/taskHub.js';
import { speakBrief } from '../src/lib/quickSay.js';

const quiet = { log() {}, warn() {}, error() {} };
// Friday 9 Oct 2026, 8:30 PM in Florida: past 00:00 UTC, when "today" used to slip
const NOW = new Date(2026, 9, 9, 20, 30).getTime();

test("all-day dates are the wall's day, not midnight UTC", () => {
	assert.ok(isAllDay('2026-10-10'));
	assert.ok(!isAllDay('2026-10-10T09:00:00-04:00'));
	// new Date('2026-10-10') would be Oct 9, 8 PM here: the old "Today" bug
	assert.equal(new Date('2026-10-10').getDate(), 9);
	assert.equal(eventDate('2026-10-10').getDate(), 10);
	assert.equal(eventDayKey('2026-10-10'), '2026-10-10');
	assert.equal(eventDayKey('2026-10-10T01:30:00Z'), '2026-10-09', 'a timed event at 9:30 PM Friday is Friday');
	assert.equal(wallDayKey(NOW), '2026-10-09');
});

test('calendar events and Google Tasks become read-only wall items', () => {
	const events = [
		{ id: 'e1', title: 'Physics lab report #hw', start: '2026-10-10', location: 'Physics · #hw' },
		{ id: 'e2', title: 'Calculus quiz', start: '2026-10-12T08:30:00-04:00' },
		{ id: 'e3', title: 'Reminder: pick up library books', start: '2026-10-09T21:00:00-04:00' },
		{ id: 'e4', title: 'Dinner with Sam', start: '2026-10-09T19:00:00-04:00' },
		{ id: 'e5', title: 'Old essay due', start: '2026-10-07' }
	];
	const gtasks = [
		{ id: 't1', title: 'Return permission slip', due: '2026-10-09T00:00:00.000Z', listTitle: 'School' },
		{ id: 't2', title: 'Buy batteries' },
		{ id: 't3', title: 'Done thing', status: 'completed' }
	];
	const items = calendarToItems({ events, gtasks }, { now: NOW });
	assert.deepEqual(
		items.map((i) => [i.id, i.kind, i.title]),
		[
			['gcal:e1', 'homework', 'Physics lab report'],
			['gcal:e2', 'homework', 'Calculus quiz'],
			['gcal:e3', 'reminder', 'pick up library books'],
			['gtask:t1', 'reminder', 'Return permission slip'],
			['gtask:t2', 'reminder', 'Buy batteries']
		],
		'non-homework events and past days are left out'
	);
	const lab = items[0];
	assert.equal(lab.allDay, true);
	assert.equal(lab.notes, 'Physics');
	assert.equal(new Date(lab.nextDue).getDate(), 10, 'due Saturday, not Friday evening');
	assert.equal(items[3].source, 'School');
	assert.ok(items.every((i) => i.external));
});

test('the hub merges them, ticking off hides them, and they stay read-only', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'cal-'));
	const sent = [];
	let feed = calendarToItems(
		{ events: [{ id: 'e1', title: 'Physics lab report #hw', start: '2026-10-09' }, { id: 'e2', title: 'Essay due', start: '2026-10-10' }] },
		{ now: NOW }
	);
	const hub = createTaskHub({ dataDir, broadcast: (m) => sent.push(m), log: quiet, now: () => NOW, env: {}, external: () => feed });
	hub.create({ title: 'Feed the cat', at: new Date(2026, 9, 9, 19).toISOString() });

	const snap = hub.snapshot();
	assert.deepEqual(
		snap.map((t) => [t.title, t.status]),
		[
			['Feed the cat', 'overdue'],
			['Physics lab report', 'today'],
			['Essay due', 'upcoming']
		],
		"tomorrow's homework is upcoming, not today"
	);
	assert.equal(snap[1].repeatText, 'All day');
	assert.equal(speakBrief(snap, NOW), 'One thing waiting: Feed the cat. Later today: Physics lab report.');

	assert.equal(hub.snooze('gcal:e1', 60).status, 409);
	assert.equal(hub.update('gcal:e1', { title: 'x' }).status, 409);
	const done = hub.done('gcal:e1');
	assert.equal(done.task.status, 'done');
	assert.ok(!hub.snapshot().some((t) => t.id === 'gcal:e1'), 'hidden on the wall');
	assert.ok(JSON.parse(readFileSync(path.join(dataDir, 'dismissed.json'), 'utf8'))['gcal:e1'], 'remembered across restarts');

	// a new hub on the same data keeps it hidden
	const again = createTaskHub({ dataDir, broadcast: () => {}, log: quiet, now: () => NOW, env: {}, external: () => feed });
	assert.ok(!again.snapshot().some((t) => t.id === 'gcal:e1'));

	// the feed changing pushes the merged list out
	sent.length = 0;
	feed = [];
	hub.externalChanged();
	assert.deepEqual(sent.at(-1).tasks.map((t) => t.title), ['Feed the cat']);
});

test('statuses that drift with the clock are re-sent without anything firing', () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'drift-'));
	const sent = [];
	const nowRef = { t: new Date(2026, 9, 9, 23, 58).getTime() };
	const hub = createTaskHub({ dataDir, broadcast: (m) => sent.push(m), log: quiet, now: () => nowRef.t, env: {} });
	hub.create({ title: 'Bins', at: new Date(2026, 9, 10, 18).toISOString() });
	hub.tick();
	sent.length = 0;
	nowRef.t += 5 * 60000; // past midnight: "upcoming" becomes "today"
	hub.tick();
	assert.equal(sent.length, 1);
	assert.equal(sent[0].tasks[0].status, 'today');
	hub.tick();
	assert.equal(sent.length, 1, 'nothing new, nothing sent');
});
