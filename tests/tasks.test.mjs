import test from 'node:test';
import assert from 'node:assert/strict';
import {
	normalizeTask,
	normalizeRepeat,
	nextOccurrence,
	taskStatus,
	completeTask,
	snoozeTask,
	tickTasks,
	sortTasks,
	taskNotify,
	describeRepeat
} from '../src/lib/tasks.js';

// Local-time helpers so the suite passes in any TZ.
const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const iso = (...a) => new Date(at(...a)).toISOString();
const local = (s) => {
	const d = new Date(s);
	return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
};
const make = (input, now = at(2026, 10, 5, 8)) => {
	const r = normalizeTask(input, { now, id: 't1' });
	assert.equal(r.error, undefined, r.error);
	return r.task;
};

test('normalizeTask validates and fills defaults', () => {
	assert.match(normalizeTask({}).error, /title/);
	assert.match(normalizeTask({ title: 'x', kind: 'nope' }).error, /kind/);
	assert.match(normalizeTask({ title: 'x', at: 'tomorrow-ish' }).error, /ISO/);
	assert.match(normalizeTask({ title: 'x', repeat: { freq: 'yearly' } }).error, /repeat/);
	const t = make({ title: '  Take   out the bins ', at: iso(2026, 10, 5, 19) });
	assert.equal(t.title, 'Take out the bins');
	assert.equal(t.kind, 'chore');
	assert.equal(t.severity, 'info');
	assert.equal(t.nextDue, t.at);
	assert.equal(make({ title: 'Meds', kind: 'alert' }).severity, 'warn');
});

test('patching keeps fields and resets the schedule only when the time changes', () => {
	const t = { ...make({ title: 'Bins', at: iso(2026, 10, 5, 19) }), doneCount: 3, notifiedFor: 'x' };
	const renamed = normalizeTask({ title: 'Recycling' }, { existing: t }).task;
	assert.equal(renamed.title, 'Recycling');
	assert.equal(renamed.doneCount, 3);
	assert.equal(renamed.notifiedFor, 'x');
	const moved = normalizeTask({ at: iso(2026, 10, 6, 19) }, { existing: t }).task;
	assert.equal(moved.nextDue, iso(2026, 10, 6, 19));
	assert.equal(moved.notifiedFor, null);
});

test('normalizeRepeat accepts shorthand and cleans weekly days', () => {
	assert.equal(normalizeRepeat('none'), null);
	assert.deepEqual(normalizeRepeat('daily'), { freq: 'daily', interval: 1 });
	assert.deepEqual(normalizeRepeat({ freq: 'weekly', days: [5, 1, 1, 9] }), { freq: 'weekly', interval: 1, days: [1, 5] });
});

test('nextOccurrence walks daily, hourly and monthly rules', () => {
	const daily = make({ title: 'a', at: iso(2026, 10, 1, 7, 30), repeat: 'daily' });
	assert.deepEqual(local(nextOccurrence(daily, at(2026, 10, 5, 8))), [2026, 10, 6, 7, 30]);
	assert.deepEqual(local(nextOccurrence(daily, at(2026, 10, 5, 7))), [2026, 10, 5, 7, 30]);

	const hourly = make({ title: 'b', at: iso(2026, 10, 5, 8), repeat: { freq: 'hourly', interval: 3 } });
	assert.deepEqual(local(nextOccurrence(hourly, at(2026, 10, 5, 12))), [2026, 10, 5, 14, 0]);

	// the 31st clamps to the end of shorter months
	const monthly = make({ title: 'c', at: iso(2026, 1, 31, 10), repeat: 'monthly' });
	assert.deepEqual(local(nextOccurrence(monthly, at(2026, 2, 1))), [2026, 2, 28, 10, 0]);

	const once = make({ title: 'd', at: iso(2026, 10, 5, 19) });
	assert.equal(nextOccurrence(once, at(2026, 10, 5, 20)), null);
});

test('weekly rules land on the listed weekdays, every N weeks from the anchor', () => {
	// Oct 5 2026 is a Monday
	const binDays = make({ title: 'Bins', at: iso(2026, 10, 5, 19), repeat: { freq: 'weekly', days: [1, 4] } });
	assert.deepEqual(local(nextOccurrence(binDays, at(2026, 10, 5, 20))), [2026, 10, 8, 19, 0]); // Thu
	assert.deepEqual(local(nextOccurrence(binDays, at(2026, 10, 8, 20))), [2026, 10, 12, 19, 0]); // Mon

	const fortnight = make({ title: 'Sheets', at: iso(2026, 10, 5, 10), repeat: { freq: 'weekly', interval: 2, days: [1] } });
	assert.deepEqual(local(nextOccurrence(fortnight, at(2026, 10, 5, 11))), [2026, 10, 19, 10, 0]);
});

test('status reads overdue, due, today, upcoming, snoozed and done', () => {
	const now = at(2026, 10, 5, 12);
	assert.equal(taskStatus(make({ title: 'a', at: iso(2026, 10, 5, 9) }), now), 'overdue');
	assert.equal(taskStatus(make({ title: 'b', kind: 'alert', at: iso(2026, 10, 5, 9) }), now), 'due');
	assert.equal(taskStatus(make({ title: 'c', at: iso(2026, 10, 5, 20) }), now), 'today');
	assert.equal(taskStatus(make({ title: 'd', at: iso(2026, 10, 7, 9) }), now), 'upcoming');
	const snoozed = snoozeTask(make({ title: 'e', at: iso(2026, 10, 5, 9) }), 30, now);
	assert.equal(taskStatus(snoozed, now), 'snoozed');
	assert.equal(taskStatus(snoozed, now + 31 * 60000), 'overdue');
});

test('completing a repeating chore advances it; a one-off retires', () => {
	const now = at(2026, 10, 5, 21);
	const weekly = make({ title: 'Bins', at: iso(2026, 10, 5, 19), repeat: { freq: 'weekly', days: [1, 4] } });
	const done = completeTask(weekly, now);
	assert.deepEqual(local(done.nextDue), [2026, 10, 8, 19, 0]);
	assert.equal(done.active, true);
	assert.equal(done.doneCount, 1);

	const once = completeTask(make({ title: 'Call plumber', at: iso(2026, 10, 5, 9) }), now);
	assert.equal(once.active, false);
	assert.equal(taskStatus(once, now), 'done');
});

test('the tick fires each occurrence once, holds snoozes, and rolls alerts on', () => {
	const now = at(2026, 10, 5, 19, 1);
	const chore = make({ title: 'Bins', at: iso(2026, 10, 5, 19) });
	const alert = { ...make({ title: 'Meds', kind: 'alert', at: iso(2026, 10, 5, 19), repeat: 'daily' }), id: 't2' };
	const later = { ...make({ title: 'Later', at: iso(2026, 10, 6, 9) }), id: 't3' };

	const first = tickTasks([chore, alert, later], now);
	assert.deepEqual(first.fired.map((t) => t.title), ['Bins', 'Meds']);
	assert.deepEqual(local(first.tasks[1].nextDue), [2026, 10, 6, 19, 0]); // alert moved on by itself
	assert.equal(taskStatus(first.tasks[0], now), 'overdue'); // chore waits to be done

	const again = tickTasks(first.tasks, now + 60000);
	assert.equal(again.fired.length, 0, 'no repeat nag for the same occurrence');

	const snoozed = snoozeTask(again.tasks[0], 10, now + 60000);
	assert.equal(tickTasks([snoozed], now + 5 * 60000).fired.length, 0);
	assert.equal(tickTasks([snoozed], now + 12 * 60000).fired.length, 1, 'nags again after the snooze');
});

test('sorting, notify payloads and plain-language rules', () => {
	const now = at(2026, 10, 5, 12);
	const list = sortTasks(
		[
			{ ...make({ title: 'upcoming', at: iso(2026, 10, 8) }), id: 'a' },
			{ ...make({ title: 'overdue', at: iso(2026, 10, 5, 8) }), id: 'b' },
			{ ...make({ title: 'today', at: iso(2026, 10, 5, 18) }), id: 'c' }
		],
		now
	);
	assert.deepEqual(list.map((t) => t.title), ['overdue', 'today', 'upcoming']);

	const n = taskNotify(make({ title: 'Bins', at: iso(2026, 10, 5, 19) }));
	assert.equal(n.kind, 'chore');
	assert.equal(n.source, 'Chores');
	assert.equal(n.body, 'Chore due now');

	assert.equal(describeRepeat(null), 'Once');
	assert.equal(describeRepeat({ freq: 'daily', interval: 1 }), 'Daily');
	assert.equal(describeRepeat({ freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] }), 'Weekdays');
	assert.equal(describeRepeat({ freq: 'weekly', interval: 2, days: [1, 4] }), 'Every 2 weeks on Mon, Thu');
});

test('a daily time holds its wall-clock hour across a DST change', () => {
	// US clocks fall back on Nov 1 2026; the item must stay at 7:30 local
	const daily = make({ title: 'Walk the dog', at: iso(2026, 10, 30, 7, 30), repeat: 'daily' });
	assert.deepEqual(local(nextOccurrence(daily, at(2026, 11, 1, 8))), [2026, 11, 2, 7, 30]);
	assert.deepEqual(local(nextOccurrence(daily, at(2026, 10, 31, 8))), [2026, 11, 1, 7, 30]);
});

test('doing a chore early uses up the current occurrence', () => {
	const weekly = make({ title: 'Bins', at: iso(2026, 10, 5, 18), repeat: { freq: 'weekly', days: [1, 4] } });
	const early = completeTask(weekly, at(2026, 10, 5, 12));
	assert.deepEqual(local(early.nextDue), [2026, 10, 8, 18, 0]);
	const onceEarly = completeTask(make({ title: 'Call plumber', at: iso(2026, 10, 5, 18) }), at(2026, 10, 5, 12));
	assert.equal(onceEarly.active, false);
});

test('a weekly rule starting on an off day first comes due on its next listed day', () => {
	// Oct 9 2026 is a Friday; the rule is Mon & Thu
	const bins = make({ title: 'Bins', at: iso(2026, 10, 9, 18), repeat: { freq: 'weekly', days: [1, 4] } });
	assert.deepEqual(local(bins.nextDue), [2026, 10, 12, 18, 0]);
	// a start that is on a listed day keeps that day
	const thu = make({ title: 'Bins', at: iso(2026, 10, 8, 18), repeat: { freq: 'weekly', days: [1, 4] } });
	assert.deepEqual(local(thu.nextDue), [2026, 10, 8, 18, 0]);
});
