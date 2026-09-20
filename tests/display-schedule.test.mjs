import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ALL_DAYS,
	crossedMinute,
	debounceSignal,
	desiredHdmi,
	envDefaults,
	formatDaysLabel,
	formatHHMM,
	isQuietHours,
	loadSchedule,
	minutesOfDay,
	nightOwnerWeekday,
	normalizeDays,
	normalizeSchedule,
	parseHHMM,
	saveSchedule,
	schedulePatchAction,
	scheduleTick,
	scheduledAction,
	weekdayInZone
} from '../src/lib/server/displaySchedule.js';

const tmpDirs = [];

function tmpDir() {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'display-schedule-'));
	tmpDirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('parseHHMM', () => {
	test('accepts padded and unpadded hours', () => {
		assert.equal(parseHHMM('22:30'), 22 * 60 + 30);
		assert.equal(parseHHMM('6:00'), 6 * 60);
		assert.equal(parseHHMM('00:00'), 0);
		assert.equal(parseHHMM('23:59'), 23 * 60 + 59);
	});

	test('accepts seconds from time inputs', () => {
		assert.equal(parseHHMM('22:30:00'), 22 * 60 + 30);
		assert.equal(parseHHMM('6:00:00'), 6 * 60);
		assert.equal(parseHHMM('07:05:09.5'), 7 * 60 + 5);
		assert.equal(normalizeSchedule({ offAt: '22:30:00', onAt: '6:00:00' }).offAt, '22:30');
		assert.equal(normalizeSchedule({ offAt: '22:30:00', onAt: '6:00:00' }).onAt, '06:00');
	});

	test('rejects garbage', () => {
		assert.equal(parseHHMM('24:00'), null);
		assert.equal(parseHHMM('9'), null);
		assert.equal(parseHHMM('12:60'), null);
		assert.equal(parseHHMM(''), null);
	});
});

describe('quiet hours', () => {
	const overnight = { enabled: true, offAt: '22:30', onAt: '06:00', timeZone: 'UTC' };
	const nap = { enabled: true, offAt: '13:00', onAt: '14:30', timeZone: 'UTC' };

	test('overnight window includes late night and early morning', () => {
		assert.equal(isQuietHours(new Date('2026-09-12T22:30:00Z'), overnight), true);
		assert.equal(isQuietHours(new Date('2026-09-12T23:59:00Z'), overnight), true);
		assert.equal(isQuietHours(new Date('2026-09-12T00:00:00Z'), overnight), true);
		assert.equal(isQuietHours(new Date('2026-09-12T05:59:00Z'), overnight), true);
		assert.equal(isQuietHours(new Date('2026-09-12T06:00:00Z'), overnight), false);
		assert.equal(isQuietHours(new Date('2026-09-12T21:00:00Z'), overnight), false);
	});

	test('same-day window is half-open [off, on)', () => {
		assert.equal(isQuietHours(new Date('2026-09-12T12:59:00Z'), nap), false);
		assert.equal(isQuietHours(new Date('2026-09-12T13:00:00Z'), nap), true);
		assert.equal(isQuietHours(new Date('2026-09-12T14:29:00Z'), nap), true);
		assert.equal(isQuietHours(new Date('2026-09-12T14:30:00Z'), nap), false);
	});

	test('disabled schedule is never quiet', () => {
		assert.equal(
			isQuietHours(new Date('2026-09-12T23:00:00Z'), { ...overnight, enabled: false }),
			false
		);
		assert.equal(desiredHdmi(new Date('2026-09-12T23:00:00Z'), { ...overnight, enabled: false }), null);
	});

	test('uses America/New_York wall time', () => {
		const eastern = { enabled: true, offAt: '22:30', onAt: '06:00', timeZone: 'America/New_York' };
		// 2026-09-12 02:30 UTC = 2026-09-11 22:30 EDT
		assert.equal(minutesOfDay(new Date('2026-09-12T02:30:00Z'), 'America/New_York'), 22 * 60 + 30);
		assert.equal(isQuietHours(new Date('2026-09-12T02:30:00Z'), eastern), true);
		// 2026-09-12 10:00 UTC = 2026-09-12 06:00 EDT
		assert.equal(isQuietHours(new Date('2026-09-12T10:00:00Z'), eastern), false);
	});
});

describe('schedule ticks', () => {
	const schedule = { enabled: true, offAt: '22:30', onAt: '06:00', timeZone: 'UTC' };

	test('fires off and on when the minute rolls across the boundary', () => {
		assert.equal(scheduledAction(22 * 60 + 29, 22 * 60 + 30, schedule), 'off');
		assert.equal(scheduledAction(5 * 60 + 59, 6 * 60, schedule), 'on');
		assert.equal(scheduledAction(12 * 60, 12 * 60 + 1, schedule), null);
	});

	test('catches a midnight wrap for a 00:00 off time', () => {
		const midnight = { ...schedule, offAt: '00:00', onAt: '06:00' };
		assert.equal(crossedMinute(23 * 60 + 59, 0, 0), true);
		assert.equal(scheduledAction(23 * 60 + 59, 0, midnight), 'off');
	});
});

describe('persist', () => {
	test('normalizes env defaults and round-trips JSON', () => {
		assert.deepEqual(
			envDefaults({ DISPLAY_SCHEDULE: '0', DISPLAY_OFF_AT: '21:15', DISPLAY_ON_AT: '7:05', TZ: 'America/New_York' }),
			{
				enabled: false,
				wakeOnPhone: true,
				offAt: '21:15',
				onAt: '07:05',
				phoneWakeAfter: '05:00',
				timeZone: 'America/New_York',
				wakeOnProximity: false,
				proximityDevice: '',
				proximityMeters: 5,
				days: ALL_DAYS
			}
		);
		const file = path.join(tmpDir(), 'display-schedule.json');
		const saved = saveSchedule(file, { enabled: false, offAt: '9:05', onAt: '07:00' });
		assert.equal(saved.offAt, '09:05');
		assert.equal(JSON.parse(readFileSync(file, 'utf8')).enabled, false);
		assert.deepEqual(loadSchedule(file, {}), saved);
		const withDays = saveSchedule(file, { ...saved, days: ['fri', 'sat'] });
		assert.deepEqual(withDays.days, [5, 6]);
		assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).days, [5, 6]);
	});

	test('falls back when the file is junk', () => {
		const file = path.join(tmpDir(), 'bad.json');
		writeFileSync(file, '{not json');
		assert.deepEqual(loadSchedule(file, {}), envDefaults({}));
	});

	test('keeps previous times when a patch is invalid', () => {
		const next = normalizeSchedule({ offAt: 'nope' }, { offAt: '22:30', onAt: '06:00', enabled: true });
		assert.equal(next.offAt, '22:30');
	});

	test('normalizeSchedule validates the proximity fields', () => {
		const withMac = normalizeSchedule({
			wakeOnProximity: true,
			proximityDevice: 'aa:bb:cc:dd:ee:ff',
			proximityMeters: 3.25
		});
		assert.equal(withMac.wakeOnProximity, true);
		assert.equal(withMac.proximityDevice, 'AA:BB:CC:DD:EE:FF');
		assert.equal(withMac.proximityMeters, 3.3);

		const badMac = normalizeSchedule({ proximityDevice: 'not-a-mac' });
		assert.equal(badMac.proximityDevice, '');

		const badMeters = normalizeSchedule({ proximityMeters: -5 }, { proximityMeters: 7 });
		assert.equal(badMeters.proximityMeters, 7);

		const clamped = normalizeSchedule({ proximityMeters: 500 });
		assert.equal(clamped.proximityMeters, 30);

		const defaults = normalizeSchedule({});
		assert.equal(defaults.wakeOnProximity, false);
		assert.equal(defaults.proximityDevice, '');
		assert.equal(defaults.proximityMeters, 5);
	});

	test('debounceSignal ignores a single flickered reading', () => {
		const state = {};
		assert.equal(debounceSignal(state, false), false);
		assert.equal(debounceSignal(state, true), false); // one-off blip, not confirmed yet
		assert.equal(debounceSignal(state, false), false); // back to false before confirming
		assert.equal(debounceSignal(state, true), false);
		assert.equal(debounceSignal(state, true), true); // two in a row: confirmed
		assert.equal(debounceSignal(state, false), true); // one-off blip back down
		assert.equal(debounceSignal(state, true), true);
		assert.equal(debounceSignal(state, false), true);
		assert.equal(debounceSignal(state, false), false); // two in a row: confirmed off
	});
});

describe('scheduled days', () => {
	const fridayNight = {
		enabled: true,
		offAt: '22:30',
		onAt: '06:00',
		timeZone: 'UTC',
		days: [5]
	};

	test('parses names, numbers, and env lists', () => {
		assert.deepEqual(normalizeDays('fri,sat'), [5, 6]);
		assert.deepEqual(normalizeDays(['Monday', 3, '3', 'nope']), [1, 3]);
		assert.deepEqual(normalizeDays([]), []);
		assert.equal(formatDaysLabel([5, 6]), 'Fri Sat');
		assert.equal(formatDaysLabel(ALL_DAYS), '');
		assert.equal(formatDaysLabel([]), 'no days');
		assert.deepEqual(
			envDefaults({ DISPLAY_SCHEDULE_DAYS: 'sun,mon,tue,wed,thu' }).days,
			[0, 1, 2, 3, 4]
		);
	});

	test('overnight mornings belong to the night that started yesterday', () => {
		assert.equal(weekdayInZone(new Date('2026-09-11T22:30:00Z'), 'UTC'), 5);
		assert.equal(weekdayInZone(new Date('2026-09-12T02:00:00Z'), 'UTC'), 6);
		assert.equal(nightOwnerWeekday(new Date('2026-09-11T22:30:00Z'), fridayNight), 5);
		assert.equal(nightOwnerWeekday(new Date('2026-09-12T02:00:00Z'), fridayNight), 5);
		assert.equal(nightOwnerWeekday(new Date('2026-09-12T06:00:00Z'), fridayNight), 5);
		assert.equal(nightOwnerWeekday(new Date('2026-09-12T22:30:00Z'), fridayNight), 6);
	});

	test('quiet hours only run on selected nights', () => {
		assert.equal(isQuietHours(new Date('2026-09-11T22:30:00Z'), fridayNight), true);
		assert.equal(isQuietHours(new Date('2026-09-12T02:00:00Z'), fridayNight), true);
		assert.equal(isQuietHours(new Date('2026-09-12T06:00:00Z'), fridayNight), false);
		assert.equal(isQuietHours(new Date('2026-09-12T22:30:00Z'), fridayNight), false);
		assert.equal(desiredHdmi(new Date('2026-09-12T22:30:00Z'), fridayNight), 'on');
		assert.equal(
			isQuietHours(new Date('2026-09-11T23:00:00Z'), { ...fridayNight, days: [] }),
			false
		);
	});

	test('ticks skip off and on when that night is not selected', () => {
		assert.equal(
			scheduledAction(22 * 60 + 29, 22 * 60 + 30, fridayNight, new Date('2026-09-11T22:30:00Z')),
			'off'
		);
		assert.equal(
			scheduledAction(5 * 60 + 59, 6 * 60, fridayNight, new Date('2026-09-12T06:00:00Z')),
			'on'
		);
		assert.equal(
			scheduledAction(22 * 60 + 29, 22 * 60 + 30, fridayNight, new Date('2026-09-12T22:30:00Z')),
			null
		);
		assert.equal(
			scheduledAction(5 * 60 + 59, 6 * 60, fridayNight, new Date('2026-09-13T06:00:00Z')),
			null
		);
	});
});

describe('formatHHMM', () => {
	test('pads hours', () => {
		assert.equal(formatHHMM(6 * 60 + 5), '06:05');
	});
});

describe('manual hold vs schedule', () => {
	const overnight = {
		enabled: true,
		offAt: '22:30',
		onAt: '06:00',
		timeZone: 'UTC',
		days: ALL_DAYS
	};
	const night = new Date('2026-09-12T23:00:00Z');
	const day = new Date('2026-09-12T15:00:00Z');

	test('boot follows the window when nobody held the power button', () => {
		assert.equal(scheduleTick({ lastMinutes: null, hold: null, schedule: overnight, date: night }).action, 'off');
		assert.equal(scheduleTick({ lastMinutes: null, hold: null, schedule: overnight, date: day }).action, 'on');
		assert.equal(
			scheduleTick({ lastMinutes: null, hold: null, schedule: { ...overnight, enabled: false }, date: night })
				.action,
			null
		);
	});

	test('boot does not undo a manual or wake hold', () => {
		const heldOn = scheduleTick({ lastMinutes: null, hold: 'on', schedule: overnight, date: night });
		assert.equal(heldOn.action, null);
		assert.equal(heldOn.hold, 'on');
		const heldOff = scheduleTick({ lastMinutes: null, hold: 'off', schedule: overnight, date: day });
		assert.equal(heldOff.action, null);
		assert.equal(heldOff.hold, 'off');
	});

	test('the next off/on alarm resumes the schedule and clears the hold', () => {
		const offAlarm = scheduleTick({
			lastMinutes: 22 * 60 + 29,
			hold: 'on',
			schedule: overnight,
			date: new Date('2026-09-12T22:30:00Z')
		});
		assert.equal(offAlarm.action, 'off');
		assert.equal(offAlarm.hold, null);

		const onAlarm = scheduleTick({
			lastMinutes: 5 * 60 + 59,
			hold: 'off',
			schedule: overnight,
			date: new Date('2026-09-12T06:00:00Z')
		});
		assert.equal(onAlarm.action, 'on');
		assert.equal(onAlarm.hold, null);
	});

	test('saving proximity or phone-wake does not force the panel back onto the window', () => {
		const prev = { ...overnight, wakeOnPhone: true, wakeOnProximity: false };
		const next = { ...overnight, wakeOnPhone: false, wakeOnProximity: true, proximityDevice: 'AA:BB:CC:DD:EE:FF' };
		assert.deepEqual(schedulePatchAction(prev, next, { hold: 'on', date: night }), {
			action: null,
			hold: 'on'
		});
	});

	test('changing days or times honors a hold instead of snapping HDMI', () => {
		const next = { ...overnight, days: [1, 2, 3], offAt: '21:00' };
		assert.deepEqual(schedulePatchAction(overnight, next, { hold: 'on', date: night }), {
			action: null,
			hold: 'on'
		});
		assert.equal(
			schedulePatchAction(overnight, { ...overnight, offAt: '21:00' }, { hold: null, date: night }).action,
			'off'
		);
		assert.equal(schedulePatchAction(overnight, next, { hold: null, date: night }).action, 'on');
		assert.equal(schedulePatchAction(overnight, next, { hold: null, date: day }).action, 'on');
	});

	test('the Auto rocker is a follow-this-now gesture', () => {
		assert.deepEqual(
			schedulePatchAction(overnight, { ...overnight, enabled: false }, { hold: 'off', date: night }),
			{ action: 'on', hold: null }
		);
		assert.deepEqual(
			schedulePatchAction({ ...overnight, enabled: false }, overnight, { hold: 'on', date: night }),
			{ action: 'off', hold: null }
		);
		assert.equal(
			schedulePatchAction({ ...overnight, enabled: false }, overnight, { hold: null, date: day }).action,
			'on'
		);
	});
});
