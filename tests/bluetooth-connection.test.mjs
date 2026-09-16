import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	isBluetoothDeviceConnected,
	parseAnyBluetoothConnected,
	resetBluetoothConnectionCache
} from '../src/lib/server/bluetoothConnection.js';

test('parseAnyBluetoothConnected reads bluetoothctl device rows', () => {
	assert.equal(parseAnyBluetoothConnected('Device AA:BB:CC:DD:EE:FF iPhone\n'), true);
	assert.equal(parseAnyBluetoothConnected(''), false);
	assert.equal(parseAnyBluetoothConnected('no devices'), false);
});

test('isBluetoothDeviceConnected caches within the TTL', () => {
	resetBluetoothConnectionCache();
	let calls = 0;
	const run = () => {
		calls += 1;
		return 'Device AA:BB:CC:DD:EE:FF iPhone\n';
	};
	let clock = 1000;
	assert.equal(isBluetoothDeviceConnected({ run, now: clock, force: true }), true);
	assert.equal(calls, 1);

	clock += 500;
	assert.equal(isBluetoothDeviceConnected({ run, now: clock }), true);
	assert.equal(calls, 1, 'should reuse the cached reading within the TTL');

	clock += 5000;
	assert.equal(isBluetoothDeviceConnected({ run, now: clock }), true);
	assert.equal(calls, 2, 'should re-probe once the TTL has passed');
});

test('isBluetoothDeviceConnected returns false when bluetoothctl fails', () => {
	resetBluetoothConnectionCache();
	const run = () => {
		throw new Error('bluetoothctl not found');
	};
	assert.equal(isBluetoothDeviceConnected({ run, now: 1, force: true }), false);
});
