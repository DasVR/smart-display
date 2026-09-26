import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	bluetoothProbeStatus,
	isBluetoothDeviceConnected,
	parseAnyBluetoothConnected,
	resetBluetoothConnectionCache,
	setBluetoothConnectionCache
} from '../src/lib/server/bluetoothConnection.js';

test('parseAnyBluetoothConnected reads bluetoothctl device rows', () => {
	assert.equal(parseAnyBluetoothConnected('Device AA:BB:CC:DD:EE:FF iPhone\n'), true);
	assert.equal(parseAnyBluetoothConnected(''), false);
	assert.equal(parseAnyBluetoothConnected('no devices'), false);
});

test('isBluetoothDeviceConnected caches within the TTL', async () => {
	resetBluetoothConnectionCache();
	let calls = 0;
	const run = () => {
		calls += 1;
		return 'Device AA:BB:CC:DD:EE:FF iPhone\n';
	};
	let clock = 1000;
	assert.equal(await isBluetoothDeviceConnected({ run, now: clock, force: true }), true);
	assert.equal(calls, 1);

	clock += 500;
	assert.equal(await isBluetoothDeviceConnected({ run, now: clock }), true);
	assert.equal(calls, 1, 'should reuse the cached reading within the TTL');

	clock += 5000;
	assert.equal(await isBluetoothDeviceConnected({ run, now: clock }), true);
	assert.equal(calls, 2, 'should re-probe once the TTL has passed');
});

test('isBluetoothDeviceConnected returns false when bluetoothctl fails', async () => {
	resetBluetoothConnectionCache();
	const run = () => {
		throw new Error('bluetoothctl not found');
	};
	assert.equal(await isBluetoothDeviceConnected({ run, now: 1, force: true }), false);
	assert.equal(bluetoothProbeStatus().ok, false);
	assert.equal(bluetoothProbeStatus().error, 'missing');
});

test('a bluetoothctl timeout does not drop a phone that was connected', async () => {
	resetBluetoothConnectionCache();
	setBluetoothConnectionCache(true, 1000);
	const run = () => {
		const error = new Error('timed out');
		error.code = 'ETIMEDOUT';
		throw error;
	};
	assert.equal(await isBluetoothDeviceConnected({ run, now: 10_000, force: true }), true);
	assert.equal(bluetoothProbeStatus().error, 'timeout');
	assert.equal(bluetoothProbeStatus().connected, true);
});

test('isBluetoothDeviceConnected awaits an async run function too', async () => {
	resetBluetoothConnectionCache();
	const run = async () => 'Device AA:BB:CC:DD:EE:FF iPhone\n';
	assert.equal(await isBluetoothDeviceConnected({ run, now: 1, force: true }), true);
});

test('setBluetoothConnectionCache skips bluetoothctl until TTL', async () => {
	resetBluetoothConnectionCache();
	let calls = 0;
	const run = () => {
		calls += 1;
		return 'Device AA:BB:CC:DD:EE:FF iPhone\n';
	};
	setBluetoothConnectionCache(false, 1000);
	assert.equal(await isBluetoothDeviceConnected({ run, now: 1100 }), false);
	assert.equal(calls, 0);
	setBluetoothConnectionCache(true, 1000);
	assert.equal(await isBluetoothDeviceConnected({ run, now: 1100 }), true);
	assert.equal(calls, 0);
});
