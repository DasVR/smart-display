import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	crossedMinute,
	desiredHdmi,
	envDefaults,
	formatHHMM,
	isQuietHours,
	loadSchedule,
	minutesOfDay,
	normalizeSchedule,
	parseHHMM,
	saveSchedule,
	scheduledAction
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
				offAt: '21:15',
				onAt: '07:05',
				timeZone: 'America/New_York'
			}
		);
		const file = path.join(tmpDir(), 'display-schedule.json');
		const saved = saveSchedule(file, { enabled: false, offAt: '9:05', onAt: '07:00' });
		assert.equal(saved.offAt, '09:05');
		assert.equal(JSON.parse(readFileSync(file, 'utf8')).enabled, false);
		assert.deepEqual(loadSchedule(file, {}), saved);
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
});

describe('formatHHMM', () => {
	test('pads hours', () => {
		assert.equal(formatHHMM(6 * 60 + 5), '06:05');
	});
});
