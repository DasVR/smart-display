import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	airplayHint,
	buildAirplayStatus,
	parseBluetoothDevices,
	parseBluetoothShow,
	parseShairportName,
	parseShairportVersion,
	parseSystemctlActive
} from '../src/lib/server/kioskStatus.js';

const SHAIRPORT_AP2 =
	'4.3.2-OpenSSL-Avahi-ALSA-pa-stdout-pipe-soxr-metadata-sysconfdir-/etc-AirPlay2';
const SHAIRPORT_AP1 =
	'3.3.9-OpenSSL-Avahi-ALSA-soxr-metadata-sysconfdir-/etc';

const BT_SHOW = `
Controller 80:32:53:12:34:56 (public)
	Manufacturer: 0x02d0 (720)
	Name: BlueZ 5.72
	Alias: Smart Display
	Class: 0x006c0000 (7077888)
	Powered: yes
	Discoverable: yes
	DiscoverableTimeout: 0x00000000 (0)
	Pairable: yes
	Discovering: no
`;

const BT_SHOW_OFF = `
Controller 80:32:53:12:34:56 (public)
	Alias: Smart Display
	Powered: no
	Discoverable: no
	Pairable: yes
`;

test('parseShairportVersion detects AirPlay 2 builds', () => {
	const ap2 = parseShairportVersion(SHAIRPORT_AP2);
	assert.equal(ap2.airplay2, true);
	assert.equal(ap2.version, '4.3.2');

	const ap1 = parseShairportVersion(SHAIRPORT_AP1);
	assert.equal(ap1.airplay2, false);
	assert.equal(ap1.version, '3.3.9');

	assert.deepEqual(parseShairportVersion(''), { airplay2: false, version: '' });
});

test('parseShairportName reads the advertised speaker name', () => {
	assert.equal(parseShairportName('general = {\n  name = "Smart Display";\n};\n'), 'Smart Display');
	assert.equal(parseShairportName("name = 'Bedroom Speaker';"), 'Bedroom Speaker');
	assert.equal(parseShairportName(''), null);
});

test('parseBluetoothShow reads adapter power and alias, not the BlueZ Name', () => {
	const on = parseBluetoothShow(BT_SHOW);
	assert.equal(on.powered, true);
	assert.equal(on.discoverable, true);
	assert.equal(on.pairable, true);
	assert.equal(on.name, 'Smart Display');
	assert.equal(on.address, '80:32:53:12:34:56');

	const off = parseBluetoothShow(BT_SHOW_OFF);
	assert.equal(off.powered, false);
	assert.equal(off.discoverable, false);

	const missing = parseBluetoothShow('No default controller available');
	assert.equal(missing.powered, false);
	assert.equal(missing.address, '');
});

test('parseBluetoothDevices reads connected rows', () => {
	const devices = parseBluetoothDevices(
		'Device 00:11:22:33:44:55 JBL Flip 6\nDevice AA:BB:CC:DD:EE:FF\n'
	);
	assert.deepEqual(devices, [
		{ address: '00:11:22:33:44:55', name: 'JBL Flip 6' },
		{ address: 'AA:BB:CC:DD:EE:FF', name: '' }
	]);
	assert.deepEqual(parseBluetoothDevices(''), []);
});

test('parseSystemctlActive maps unit states', () => {
	assert.equal(parseSystemctlActive('active\n'), 'active');
	assert.equal(parseSystemctlActive('inactive'), 'inactive');
	assert.equal(parseSystemctlActive('failed'), 'failed');
	assert.equal(parseSystemctlActive('activating'), 'activating');
	assert.equal(parseSystemctlActive(null), 'unknown');
	assert.equal(parseSystemctlActive(''), 'unknown');
});

test('buildAirplayStatus is ready only when AP2 and the advertising stack are up', () => {
	const ready = buildAirplayStatus({
		binary: '/usr/local/bin/shairport-sync',
		versionText: SHAIRPORT_AP2,
		confText: 'name = "Smart Display";',
		unit: 'active',
		meta: 'active',
		nqptp: 'active',
		avahi: 'active'
	});
	assert.equal(ready.ready, true);
	assert.equal(ready.airplay2, true);
	assert.equal(ready.name, 'Smart Display');
	assert.equal(ready.hint, 'Apple Music should list Smart Display');

	const stopped = buildAirplayStatus({
		binary: '/usr/local/bin/shairport-sync',
		versionText: SHAIRPORT_AP2,
		confText: 'name = "Smart Display";',
		unit: 'inactive',
		meta: 'inactive',
		nqptp: 'active',
		avahi: 'active'
	});
	assert.equal(stopped.ready, false);
	assert.equal(stopped.hint, 'AirPlay unit is stopped');

	const noAp2 = buildAirplayStatus({
		binary: '/usr/bin/shairport-sync',
		versionText: SHAIRPORT_AP1,
		confText: '',
		unit: 'active',
		meta: 'inactive',
		nqptp: 'inactive',
		avahi: 'active'
	});
	assert.equal(noAp2.ready, false);
	assert.equal(noAp2.airplay2, false);
	assert.equal(noAp2.hint, 'shairport-sync is not AirPlay 2');

	const missing = buildAirplayStatus({
		binary: '',
		versionText: '',
		confText: '',
		unit: 'unknown',
		meta: 'unknown',
		nqptp: 'unknown',
		avahi: 'unknown'
	});
	assert.equal(missing.installed, false);
	assert.equal(missing.hint, 'shairport-sync is not installed');
});

test('airplayHint names nqptp and Avahi when those are the missing pieces', () => {
	assert.equal(
		airplayHint({
			ready: false,
			installed: true,
			airplay2: true,
			unit: 'active',
			nqptp: 'inactive',
			avahi: 'active',
			name: 'Smart Display'
		}),
		'nqptp is stopped'
	);
	assert.equal(
		airplayHint({
			ready: false,
			installed: true,
			airplay2: true,
			unit: 'active',
			nqptp: 'active',
			avahi: 'inactive',
			name: 'Smart Display'
		}),
		'Avahi is stopped'
	);
});
