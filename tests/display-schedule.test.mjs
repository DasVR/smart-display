import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ALL_DAYS,
	applyDisplayPatch,
	debounceSignal,
	describeWeek,
	desiredHdmi,
	envDefaults,
	formatHHMM,
	isAwake,
	isPhoneWakeWindow,
	isQuietHours,
	loadSchedule,
	minutesOfDay,
	nextChange,
	normalizeDay,
	normalizeDays,
	normalizeSchedule,
	normalizeWeek,
	parseHHMM,
	saveSchedule,
	schedulePatchAction,
	scheduleTick,
	weekFromLegacy,
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

const day = (on, off, mode = 'times') => ({ mode, on, off });
// 2026-10-05 is a Monday; UTC keeps these readable
const at = (iso) => new Date(`${iso}Z`);
const weekdays = day('06:30', '22:30');
const weekendLate = day('08:00', '01:00'); // runs past midnight
const UTC = (week, extra = {}) => ({ enabled: true, wakeOnPhone: true, phoneWakeAfter: '05:00', timeZone: 'UTC', week, ...extra });
const mine = UTC([day('08:00', '22:30'), weekdays, weekdays, weekdays, weekdays, weekendLate, weekendLate]);

describe('times', () => {
	test('parseHHMM accepts what time inputs send, rejects garbage', () => {
		assert.equal(parseHHMM('22:30'), 22 * 60 + 30);
		assert.equal(parseHHMM('6:00'), 6 * 60);
		assert.equal(parseHHMM('07:05:09.5'), 7 * 60 + 5);
		for (const bad of ['24:00', '9', '12:60', '']) assert.equal(parseHHMM(bad), null, bad);
		assert.equal(formatHHMM(65), '01:05');
		assert.equal(formatHHMM(-30), '23:30');
	});

	test('a day: cleaned up, equal times mean on all day', () => {
		assert.deepEqual(normalizeDay({ mode: 'times', on: '6:00:00', off: '22:30' }), day('06:00', '22:30'));
		assert.deepEqual(normalizeDay({ mode: 'times', on: '07:00', off: '07:00' }), day('07:00', '07:00', 'on'));
		assert.deepEqual(normalizeDay({ mode: 'nonsense', on: 'x', off: 'y' }, day('09:00', '17:00', 'off')), day('09:00', '17:00', 'off'));
		const week = normalizeWeek([day('08:00', '20:00')]);
		assert.equal(week.length, 7);
		assert.deepEqual(week[0], day('08:00', '20:00'));
		assert.deepEqual(week[1], day('06:00', '22:30'), 'missing days take the default');
	});
});

describe('on and off, per day', () => {
	test('each day has its own on and off', () => {
		assert.equal(desiredHdmi(at('2026-10-05T06:29'), mine), 'off', 'Monday before 6:30');
		assert.equal(desiredHdmi(at('2026-10-05T06:30'), mine), 'on', 'Monday at 6:30');
		assert.equal(desiredHdmi(at('2026-10-05T22:29'), mine), 'on');
		assert.equal(desiredHdmi(at('2026-10-05T22:30'), mine), 'off', 'Monday off at 22:30');
		assert.equal(desiredHdmi(at('2026-10-04T07:59'), mine), 'off', 'Sunday sleeps in');
		assert.equal(desiredHdmi(at('2026-10-04T08:00'), mine), 'on');
	});

	test('an off time after midnight belongs to the evening before', () => {
		assert.equal(desiredHdmi(at('2026-10-09T23:30'), mine), 'on', 'Friday night');
		assert.equal(desiredHdmi(at('2026-10-10T00:59'), mine), 'on', 'still Friday night, Saturday morning');
		assert.equal(desiredHdmi(at('2026-10-10T01:00'), mine), 'off');
		assert.equal(desiredHdmi(at('2026-10-10T07:59'), mine), 'off');
		assert.equal(desiredHdmi(at('2026-10-10T08:00'), mine), 'on', 'Saturday on');
		assert.equal(desiredHdmi(at('2026-10-11T00:30'), mine), 'on', 'Saturday night runs late too');
		assert.equal(desiredHdmi(at('2026-10-05T00:30'), mine), 'off', 'but Sunday night does not');
	});

	test('on all day, off all day', () => {
		const away = UTC([day('08:00', '22:00', 'off'), weekdays, weekdays, weekdays, weekdays, weekdays, day('00:00', '00:00', 'on')]);
		assert.equal(desiredHdmi(at('2026-10-10T03:00'), away), 'on', 'Saturday all day');
		assert.equal(desiredHdmi(at('2026-10-10T23:59'), away), 'on');
		assert.equal(desiredHdmi(at('2026-10-11T12:00'), away), 'off', 'Sunday all day');
		assert.equal(isQuietHours(at('2026-10-11T12:00'), away), true);
	});

	test('paused: never quiet, no opinion', () => {
		const paused = { ...mine, enabled: false };
		assert.equal(desiredHdmi(at('2026-10-05T03:00'), paused), null);
		assert.equal(isQuietHours(at('2026-10-05T03:00'), paused), false);
		assert.equal(isAwake(at('2026-10-05T03:00'), paused), false, 'what the week says, regardless');
	});

	test('the wall clock, not UTC', () => {
		const ny = { ...mine, timeZone: 'America/New_York' };
		// 2026-10-06 02:29 UTC = Monday 22:29 EDT
		assert.equal(minutesOfDay(at('2026-10-06T02:29'), 'America/New_York'), 22 * 60 + 29);
		assert.equal(weekdayInZone(at('2026-10-06T02:29'), 'America/New_York'), 1);
		assert.equal(desiredHdmi(at('2026-10-06T02:29'), ny), 'on');
		assert.equal(desiredHdmi(at('2026-10-06T02:30'), ny), 'off');
	});

	test('daylight saving: a skipped hour still lands right', () => {
		// 2026-03-08 in New York: 2:00 AM jumps to 3:00 AM
		const ny = UTC(ALL_DAYS.map(() => day('02:30', '23:00')), { timeZone: 'America/New_York' });
		assert.equal(desiredHdmi(new Date('2026-03-08T06:59:00Z'), ny), 'off', '1:59 AM EST');
		assert.equal(desiredHdmi(new Date('2026-03-08T07:00:00Z'), ny), 'on', '3:00 AM EDT: 2:30 never happened, but it is past it');
	});
});

describe('the next change', () => {
	test('names when and which way', () => {
		assert.deepEqual(nextChange(at('2026-10-05T12:00'), mine), { at: '2026-10-05T22:30:00.000Z', to: 'off' });
		assert.deepEqual(nextChange(at('2026-10-05T23:00'), mine), { at: '2026-10-06T06:30:00.000Z', to: 'on' });
		assert.deepEqual(nextChange(at('2026-10-09T23:00'), mine), { at: '2026-10-10T01:00:00.000Z', to: 'off' }, 'Friday late');
		assert.deepEqual(nextChange(at('2026-10-05T22:29:40'), mine), { at: '2026-10-05T22:30:00.000Z', to: 'off' }, 'to the minute');
	});

	test('nothing changes: null', () => {
		assert.equal(nextChange(at('2026-10-05T12:00'), UTC(ALL_DAYS.map(() => day('00:00', '00:00', 'on')))), null);
		assert.equal(nextChange(at('2026-10-05T12:00'), { ...mine, enabled: false }), null);
	});
});

describe('the server tick', () => {
	test('boot follows the schedule unless someone held the power', () => {
		assert.deepEqual(scheduleTick({ lastDesired: null, hold: null, schedule: mine, date: at('2026-10-05T03:00') }), { lastDesired: 'off', hold: null, action: 'off' });
		assert.deepEqual(scheduleTick({ lastDesired: null, hold: 'on', schedule: mine, date: at('2026-10-05T03:00') }), { lastDesired: 'off', hold: 'on', action: null });
	});

	test('acts when the schedule changes its mind, and only then', () => {
		const t = (iso, lastDesired, hold = null) => scheduleTick({ lastDesired, hold, schedule: mine, date: at(iso) });
		assert.equal(t('2026-10-05T12:00', 'on').action, null);
		assert.deepEqual(t('2026-10-05T22:30', 'on'), { lastDesired: 'off', hold: null, action: 'off' });
		// the server was down across 22:30 (or a tick was missed): it still notices
		assert.equal(t('2026-10-05T23:47', 'on').action, 'off');
	});

	test('a hold lasts until the next change, then the schedule takes over', () => {
		const t = (iso, lastDesired, hold) => scheduleTick({ lastDesired, hold, schedule: mine, date: at(iso) });
		// turned on by hand at 23:00 Monday
		assert.deepEqual(t('2026-10-05T23:30', 'off', 'on'), { lastDesired: 'off', hold: 'on', action: null });
		// Tuesday 06:30: the schedule wants on anyway; hold is cleared
		assert.deepEqual(t('2026-10-06T06:30', 'off', 'on'), { lastDesired: 'on', hold: null, action: 'on' });
	});
});

describe('the phone may wake it early', () => {
	test('after phoneWakeAfter, before that morning\'s on time', () => {
		assert.equal(isPhoneWakeWindow(at('2026-10-05T04:59'), mine), false);
		assert.equal(isPhoneWakeWindow(at('2026-10-05T05:00'), mine), true);
		assert.equal(isPhoneWakeWindow(at('2026-10-05T06:29'), mine), true);
		assert.equal(isPhoneWakeWindow(at('2026-10-05T06:30'), mine), false, 'on anyway');
		assert.equal(isPhoneWakeWindow(at('2026-10-10T07:00'), mine), true, 'Saturday, before 8');
		assert.equal(isPhoneWakeWindow(at('2026-10-05T05:30'), { ...mine, wakeOnPhone: false }), false);
		const offSunday = UTC([day('08:00', '22:00', 'off'), weekdays, weekdays, weekdays, weekdays, weekdays, weekdays]);
		assert.equal(isPhoneWakeWindow(at('2026-10-11T09:00'), offSunday), true, 'a day off all day: until noon');
		assert.equal(isPhoneWakeWindow(at('2026-10-11T13:00'), offSunday), false);
	});
});

describe('saving changes', () => {
	test('one day, a copy, the whole week', () => {
		const base = normalizeSchedule({ week: mine.week, timeZone: 'UTC' });
		let { next, changed } = applyDisplayPatch(base, { day: 'sat', mode: 'off' });
		assert.equal(changed, true);
		assert.equal(next.week[6].mode, 'off');
		assert.deepEqual(next.week[5], weekendLate, 'others untouched');

		({ next } = applyDisplayPatch(base, { day: 1, on: '05:45' }));
		assert.deepEqual(next.week[1], day('05:45', '22:30'));

		({ next } = applyDisplayPatch(base, { copyDay: 'sat', to: 'weekdays' }));
		assert.deepEqual(next.week.slice(1, 6), Array(5).fill(weekendLate));
		assert.deepEqual(next.week[0], day('08:00', '22:30'));
		({ next } = applyDisplayPatch(base, { copyDay: 1, to: 'weekend' }));
		assert.deepEqual([next.week[0], next.week[6]], [weekdays, weekdays]);
		({ next } = applyDisplayPatch(base, { copyDay: 1, to: 'all' }));
		assert.deepEqual(next.week, Array(7).fill(weekdays));

		({ next } = applyDisplayPatch(base, { week: Array(7).fill(day('07:00', '23:00')) }));
		assert.deepEqual(next.week[3], day('07:00', '23:00'));

		assert.equal(applyDisplayPatch(base, {}).changed, false, 'nothing asked, nothing saved');
		assert.equal(applyDisplayPatch(base, { hdmi: 'on' }).changed, false);
	});

	test('the old single window still works, and sets every day', () => {
		const base = normalizeSchedule({ week: mine.week });
		const { next } = applyDisplayPatch(base, { offAt: '21:00', onAt: '07:00' });
		assert.deepEqual(normalizeWeek(next.week), Array(7).fill(day('07:00', '21:00')));
	});

	test('editing the times keeps a hand-made hold; Auto on/off is "follow it now"', () => {
		const prev = normalizeSchedule({ week: mine.week, timeZone: 'UTC' });
		const edited = { ...prev, week: Array(7).fill(day('07:00', '20:00')) };
		const night = at('2026-10-05T21:00');
		assert.deepEqual(schedulePatchAction(prev, edited, { hold: 'on', date: night }), { action: null, hold: 'on' });
		assert.deepEqual(schedulePatchAction(prev, edited, { hold: null, date: night }), { action: 'off', hold: null });
		assert.deepEqual(schedulePatchAction(prev, { ...prev, wakeOnProximity: true }, { hold: null, date: night }), { action: null, hold: null }, 'proximity tweaks leave the panel alone');
		assert.deepEqual(schedulePatchAction(prev, { ...prev, enabled: false }, { hold: 'off', date: night }), { action: 'on', hold: null });
		assert.deepEqual(schedulePatchAction({ ...prev, enabled: false }, prev, { hold: 'on', date: at('2026-10-05T23:00') }), { action: 'off', hold: null });
	});

	test('sums up the week', () => {
		assert.equal(describeWeek(mine.week), 'Mon–Thu 6:30 AM–10:30 PM · Fri, Sat 8 AM–1 AM · Sun 8 AM–10:30 PM');
		assert.equal(describeWeek(normalizeWeek()), 'Every day 6 AM–10:30 PM');
	});
});

describe('from the old single window', () => {
	test('nights in `days` go off that evening and on the next morning; the rest stay on', () => {
		const week = weekFromLegacy({ offAt: '21:15', onAt: '06:00', days: ['fri', 'sat'] });
		assert.deepEqual(week[5], day('00:00', '21:15'), 'Friday: Thursday night stayed on, off Friday night');
		assert.deepEqual(week[6], day('06:00', '21:15'));
		assert.deepEqual(week[0], day('06:00', '00:00'), 'Sunday: on at 6, Sunday night stays on');
		assert.deepEqual(week[2], day('00:00', '00:00', 'on'));
		const legacy = { enabled: true, timeZone: 'UTC', offAt: '21:15', onAt: '06:00', days: [5, 6] };
		assert.equal(desiredHdmi(at('2026-10-09T21:15'), legacy), 'off', 'Friday 21:15');
		assert.equal(desiredHdmi(at('2026-10-10T05:59'), legacy), 'off');
		assert.equal(desiredHdmi(at('2026-10-10T06:00'), legacy), 'on');
		assert.equal(desiredHdmi(at('2026-10-08T03:00'), legacy), 'on', 'a Thursday night that was never scheduled');
	});

	test('an old file, and old env variables, become a week', () => {
		const file = path.join(tmpDir(), 'display-schedule.json');
		writeFileSync(file, JSON.stringify({ enabled: true, offAt: '22:00', onAt: '07:00', days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'UTC' }));
		const loaded = loadSchedule(file, {});
		assert.deepEqual(loaded.week, Array(7).fill(day('07:00', '22:00')));
		assert.equal('offAt' in loaded, false, 'only the week is kept');

		const env = envDefaults({ DISPLAY_SCHEDULE: '0', DISPLAY_OFF_AT: '21:15', DISPLAY_ON_AT: '7:05', TZ: 'America/New_York' });
		assert.equal(env.enabled, false);
		assert.equal(env.timeZone, 'America/New_York');
		assert.deepEqual(env.week, Array(7).fill(day('07:05', '21:15')));
		const json = envDefaults({ DISPLAY_WEEK: JSON.stringify(Array(7).fill(day('09:00', '18:00'))) });
		assert.deepEqual(json.week[2], day('09:00', '18:00'));
		assert.deepEqual(envDefaults({}).week, normalizeWeek(), 'nothing set: the default week');
	});

	test('round-trips JSON, falls back when the file is junk', () => {
		const file = path.join(tmpDir(), 'display-schedule.json');
		const saved = saveSchedule(file, { enabled: false, week: mine.week });
		assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).week, mine.week);
		assert.deepEqual(loadSchedule(file, {}), saved);
		writeFileSync(file, '{not json');
		assert.deepEqual(loadSchedule(file, {}), envDefaults({}));
	});
});

describe('days and proximity', () => {
	test('parses names, numbers, and env lists', () => {
		assert.deepEqual(normalizeDays('fri,sat'), [5, 6]);
		assert.deepEqual(normalizeDays(['Mon', 3, '0']), [0, 1, 3]);
		assert.deepEqual(normalizeDays([]), []);
	});

	test('normalizeSchedule validates the proximity fields', () => {
		const withMac = normalizeSchedule({ wakeOnProximity: true, proximityDevice: 'aa:bb:cc:dd:ee:ff', proximityMeters: 3.25 });
		assert.equal(withMac.proximityDevice, 'AA:BB:CC:DD:EE:FF');
		assert.equal(withMac.proximityMeters, 3.3);
		assert.equal(normalizeSchedule({ proximityDevice: 'not-a-mac' }).proximityDevice, '');
		assert.equal(normalizeSchedule({ proximityMeters: -5 }, { proximityMeters: 7 }).proximityMeters, 7);
		assert.equal(normalizeSchedule({ proximityMeters: 500 }).proximityMeters, 30);
	});

	test('debounceSignal ignores a single flickered reading', () => {
		const state = {};
		assert.equal(debounceSignal(state, false), false);
		assert.equal(debounceSignal(state, true), false);
		assert.equal(debounceSignal(state, false), false);
		assert.equal(debounceSignal(state, true), false);
		assert.equal(debounceSignal(state, true), true);
		assert.equal(debounceSignal(state, false), true);
		assert.equal(debounceSignal(state, false), false);
	});
});
