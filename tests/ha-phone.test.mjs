import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { becameOn, describePhoneSensor, isSensorOn, pickPhoneWakeSensor } from '../src/lib/server/haPhone.js';
import { isPhoneWakeWindow } from '../src/lib/server/displaySchedule.js';

const overnight = {
	enabled: true,
	wakeOnPhone: true,
	offAt: '22:30',
	onAt: '06:00',
	phoneWakeAfter: '05:00',
	timeZone: 'UTC'
};

describe('pickPhoneWakeSensor', () => {
	const states = [
		{ entity_id: 'light.kitchen', state: 'on' },
		{ entity_id: 'binary_sensor.pixel_8_interactive', state: 'off', attributes: { friendly_name: 'Pixel 8' } },
		{ entity_id: 'binary_sensor.front_door', state: 'off' }
	];

	test('prefers companion interactive sensors', () => {
		assert.equal(pickPhoneWakeSensor(states).entity_id, 'binary_sensor.pixel_8_interactive');
	});

	test('honors HA_PHONE_ENTITY', () => {
		const picked = pickPhoneWakeSensor(states, { HA_PHONE_ENTITY: 'binary_sensor.front_door' });
		assert.equal(picked.entity_id, 'binary_sensor.front_door');
	});

	test('returns null when nothing matches', () => {
		assert.equal(pickPhoneWakeSensor([{ entity_id: 'light.kitchen', state: 'on' }]), null);
	});
});

describe('phone on edges', () => {
	test('treats on/home/unlocked as awake, and unavailable to on as a power-up', () => {
		assert.equal(isSensorOn({ state: 'on' }), true);
		assert.equal(isSensorOn({ state: 'unavailable' }), false);
		assert.equal(becameOn({ state: 'unavailable' }, { state: 'on' }), true);
		assert.equal(becameOn({ state: 'off' }, { state: 'on' }), true);
		assert.equal(becameOn({ state: 'on' }, { state: 'on' }), false);
	});

	test('describePhoneSensor uses the friendly name', () => {
		assert.deepEqual(
			describePhoneSensor({
				entity_id: 'binary_sensor.pixel_8_interactive',
				state: 'on',
				attributes: { friendly_name: 'Pixel 8' }
			}),
			{ entity: 'binary_sensor.pixel_8_interactive', label: 'Pixel 8', on: true }
		);
	});
});

describe('phone wake window', () => {
	test('only fires in the last stretch of quiet hours', () => {
		assert.equal(isPhoneWakeWindow(new Date('2026-09-12T05:00:00Z'), overnight), true);
		assert.equal(isPhoneWakeWindow(new Date('2026-09-12T05:59:00Z'), overnight), true);
		assert.equal(isPhoneWakeWindow(new Date('2026-09-12T04:59:00Z'), overnight), false);
		assert.equal(isPhoneWakeWindow(new Date('2026-09-12T23:00:00Z'), overnight), false);
		assert.equal(isPhoneWakeWindow(new Date('2026-09-12T06:00:00Z'), overnight), false);
	});

	test('respects the wakeOnPhone flag', () => {
		assert.equal(
			isPhoneWakeWindow(new Date('2026-09-12T05:30:00Z'), { ...overnight, wakeOnPhone: false }),
			false
		);
	});
});
