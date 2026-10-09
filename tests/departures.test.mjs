import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDeparture, departureBoard, destination, isDeparture, weatherRows } from '../src/lib/departures.js';
import { decideSmartStack, HANDS_OFF_MS } from '../src/lib/smartStack.js';

const at = (h, m = 0) => new Date(2026, 9, 9, h, m).getTime();
const iso = (ms) => new Date(ms).toISOString();
const leave = (h, m, extra = {}) => ({
	id: 'leave',
	kind: 'alert',
	title: 'Leave for school',
	active: true,
	nextDue: iso(at(h, m)),
	...extra
});

test('which items are departures, and where to', () => {
	assert.ok(isDeparture({ title: 'Leave for practice' }));
	assert.ok(isDeparture({ title: 'head out to the airport' }));
	assert.ok(!isDeparture({ title: 'Leaves in the gutter' }));
	assert.equal(destination('Leave for school'), 'School');
	assert.equal(destination('leave to the airport'), 'The airport');
	assert.equal(destination('Leave'), 'Out');
});

test('the board shows in the hour before, and a few minutes after', () => {
	assert.equal(currentDeparture([leave(7, 40)], at(6, 30)), null, 'too early');
	assert.equal(currentDeparture([leave(7, 40)], at(6, 41))?.leaveAt, at(7, 40));
	assert.equal(currentDeparture([leave(7, 40)], at(7, 46)), null, 'grace over');
	// the alert fired at 7:40 and rolled on to tomorrow; lastDoneAt keeps it on screen
	const fired = leave(7, 40, { nextDue: iso(at(7, 40) + 86400000), lastDoneAt: iso(at(7, 40)) });
	assert.equal(currentDeparture([fired], at(7, 42))?.leaveAt, at(7, 40));
	assert.equal(currentDeparture([{ ...leave(7, 40), title: 'Feed the cat' }], at(7, 30)), null);
});

test('countdown phases', () => {
	const phase = (h, m) => departureBoard({ tasks: [leave(7, 40)], now: at(h, m) }).phase;
	assert.equal(phase(7, 0), 'ontime');
	assert.equal(phase(7, 30), 'boarding');
	assert.equal(phase(7, 36), 'final');
	assert.equal(phase(7, 41), 'go');
	assert.equal(departureBoard({ tasks: [leave(7, 40)], now: at(7, 34) }).minutes, 6);
});

test('rows: notes, weather, chores before you go, homework due today', () => {
	const tasks = [
		leave(7, 40, { notes: 'PE kit, lunch' }),
		{ id: 'bins', kind: 'chore', title: 'Bins out', active: true, nextDue: iso(at(7, 0)) },
		{ id: 'cat', kind: 'chore', title: 'Feed the cat', active: true, nextDue: iso(at(7, 30)) },
		{ id: 'later', kind: 'chore', title: 'Water plants', active: true, nextDue: iso(at(18)) }
	];
	const hourly = [];
	for (let h = 6; h < 20; h++) hourly.push({ time: iso(at(h)), temp: h < 9 ? 44 : 61, precipitation_probability: h === 15 ? 70 : 5 });
	const events = [
		{ id: 'e1', title: 'Physics lab report', start: iso(at(23, 59)), location: 'Physics · #hw' },
		{ id: 'e2', title: 'Calculus set', start: iso(at(9) + 86400000), location: 'Calculus · #hw' }
	];
	const b = departureBoard({ tasks, events, weather: { hourly, prediction: {} }, now: at(7, 10) });
	assert.equal(b.title, 'School');
	assert.deepEqual(
		b.rows.map((r) => [r.status, r.label]),
		[
			['bring', 'PE kit'],
			['bring', 'Lunch'],
			['bring', 'Umbrella'],
			['bring', 'Jacket'],
			['do', 'Bins out'],
			['do', 'Feed the cat'],
			['due', 'Physics lab report']
		]
	);
	assert.match(b.rows[2].detail, /^Rain 70% around 3:00/);
	assert.equal(b.rows[4].taskId, 'bins', 'chore rows can be ticked off from the board');
});

test('weather rows stay quiet on a mild dry day', () => {
	const hourly = [{ time: iso(at(8)), temp: 66, precipitation_probability: 10 }];
	assert.deepEqual(weatherRows({ hourly, prediction: { rain60min: 0.05 } }, at(8)), []);
	assert.equal(weatherRows({ hourly, prediction: { rain30min: 0.6 } }, at(8))[0].detail, 'Rain on the radar now');
});

test('Smart Stack brings the board forward once, and holds Music off while it is up', () => {
	const base = { now: 1e9, lastInput: 1e9 - HANDS_OFF_MS, playing: false, wasPlaying: false };
	assert.deepEqual(decideSmartStack({ ...base, view: 'agents', departing: true, wasDeparting: false }), {
		view: 'clock',
		autoFrom: 'agents',
		reason: 'departure'
	});
	assert.equal(decideSmartStack({ ...base, view: 'agents', departing: true, wasDeparting: true }), null, 'only on the way in');
	assert.equal(decideSmartStack({ ...base, view: 'clock', playing: true, departing: true, wasDeparting: true }), null);
	assert.equal(
		decideSmartStack({ ...base, view: 'clock', departing: false, wasDeparting: true, autoFrom: 'agents' })?.view,
		'agents',
		'back where it was afterwards'
	);
});
