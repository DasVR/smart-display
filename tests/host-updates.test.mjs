import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	assembleHostUpdates,
	debounceInstalling,
	hostUpdateChanges,
	islandActivityForUpdates,
	parseAptCheck,
	parseAptListUpgradable,
	parseFwupdJson,
	parseFwupdProcessList,
	parseFwupdText,
	parseLockHolder,
	parsePgrepHit,
	parseRebootPkgs,
	parseUpdateNotifier
} from '../src/lib/hostUpdatesModel.js';
import { getHostUpdates } from '../src/lib/server/hostUpdates.js';
import {
	hostUpdateNotifies,
	installInProgressNotify,
	updateAvailableNotify
} from '../src/lib/server/notifyPayload.js';

test('parseAptCheck reads Ubuntu stderr counts', () => {
	assert.deepEqual(parseAptCheck('5;2'), { packages: 5, security: 2 });
	assert.deepEqual(parseAptCheck('0;0'), { packages: 0, security: 0 });
	assert.deepEqual(parseAptCheck('\n12;3\n'), { packages: 12, security: 3 });
	assert.equal(parseAptCheck(''), null);
	assert.equal(parseAptCheck('no counts'), null);
});

test('parseAptListUpgradable counts upgradable rows', () => {
	const text = `Listing...
linux-generic/noble-updates 6.8.0-71.71 amd64 [upgradable from: 6.8.0-60.63]
curl/noble-updates 8.5.0-2ubuntu10.6 amd64 [upgradable from: 8.5.0-2ubuntu10.4]
WARNING: apt does not have a stable CLI interface.
`;
	assert.deepEqual(parseAptListUpgradable(text), { packages: 2, security: 0 });
	assert.deepEqual(parseAptListUpgradable('Listing...'), { packages: 0, security: 0 });
});

test('parseUpdateNotifier reads motd-style files', () => {
	assert.deepEqual(
		parseUpdateNotifier(
			'5 updates can be applied immediately.\n2 of these updates are security updates.\n'
		),
		{ packages: 5, security: 2 }
	);
	assert.deepEqual(
		parseUpdateNotifier('15 packages can be updated.\n7 updates are security updates.\n'),
		{ packages: 15, security: 7 }
	);
	assert.equal(parseUpdateNotifier('System is up to date'), null);
});

test('parseFwupdJson counts devices that have releases', () => {
	const json = JSON.stringify({
		Devices: [
			{ Name: 'System Firmware', Releases: [{ Version: '1.2.3' }] },
			{ Name: 'UEFI dbx', Releases: [] }
		]
	});
	assert.deepEqual(parseFwupdJson(json), {
		count: 1,
		names: ['System Firmware']
	});
	assert.deepEqual(parseFwupdJson('{"Devices":[]}'), { count: 0, names: [] });
	assert.deepEqual(
		parseFwupdJson('WARNING: x\n{"Devices":[{"Name":"Dock","Releases":[{}]}]}'),
		{ count: 1, names: ['Dock'] }
	);
	assert.equal(parseFwupdJson('No updates available'), null);
});

test('parseFwupdText treats no-updates as zero', () => {
	assert.deepEqual(parseFwupdText('No updates available'), { count: 0, names: [] });
	assert.deepEqual(parseFwupdText('Selected device: System Firmware\nUpgrade from 1.0 to 1.1\n'), {
		count: 1,
		names: ['System Firmware']
	});
});

test('parseFwupdProcessList ignores get-updates probes', () => {
	assert.equal(parseFwupdProcessList('1234 fwupdmgr get-updates --json'), false);
	assert.equal(parseFwupdProcessList('5678 fwupdmgr update'), true);
	assert.equal(parseFwupdProcessList('90 fwupdmgr install /tmp/fw.cab'), true);
	assert.equal(parseFwupdProcessList(''), false);
});

test('parseLockHolder and reboot package list', () => {
	assert.equal(parseLockHolder('/var/lib/dpkg/lock-frontend:  4412'), true);
	assert.equal(parseLockHolder(''), false);
	assert.equal(parseLockHolder('fuser: command not found'), false);
	assert.equal(parsePgrepHit('4412\n'), true);
	assert.equal(parsePgrepHit('pgrep: unknown option'), false);
	assert.deepEqual(parseRebootPkgs('linux-image-6.8.0-71-generic\nlibc6\n'), [
		'linux-image-6.8.0-71-generic',
		'libc6'
	]);
});

test('islandActivityForUpdates stays quiet when current', () => {
	assert.equal(islandActivityForUpdates(assembleHostUpdates()), null);
});

test('islandActivityForUpdates names packages, firmware, install, reboot', () => {
	assert.deepEqual(
		islandActivityForUpdates(assembleHostUpdates({ packages: 5, security: 2, source: 'apt-check' })),
		{
			kind: 'update',
			title: 'Package updates',
			body: '5 packages, 2 security',
			severity: 'warn'
		}
	);
	assert.equal(
		islandActivityForUpdates(
			assembleHostUpdates({ firmware: 1, firmwareNames: ['System Firmware'] })
		).title,
		'Firmware update'
	);
	assert.equal(
		islandActivityForUpdates(assembleHostUpdates({ packagesInstalling: true })),
		null
	);
	assert.equal(
		islandActivityForUpdates(assembleHostUpdates({ packages: 3, packagesInstalling: true })).title,
		'Package updates'
	);
	assert.equal(
		islandActivityForUpdates({
			...assembleHostUpdates({ packages: 3 }),
			progress: {
				active: true,
				phase: 'packages',
				title: 'Installing packages',
				done: 2,
				total: 5
			}
		}).body,
		'2/5'
	);
	assert.equal(
		islandActivityForUpdates(assembleHostUpdates({ rebootRequired: true, rebootPkgs: ['linux'] }))
			.title,
		'Restart needed'
	);
});

test('debounceInstalling ignores a single flickered reading', () => {
	const state = {};
	assert.equal(debounceInstalling(state, false), false);
	assert.equal(debounceInstalling(state, true), false); // one-off blip, not confirmed yet
	assert.equal(debounceInstalling(state, false), false); // back to false before confirming
	assert.equal(debounceInstalling(state, true), false);
	assert.equal(debounceInstalling(state, true), true); // two in a row: confirmed
	assert.equal(debounceInstalling(state, false), true); // one-off blip back down
	assert.equal(debounceInstalling(state, true), true);
	assert.equal(debounceInstalling(state, false), true);
	assert.equal(debounceInstalling(state, false), false); // two in a row: confirmed off
});

test('hostUpdateChanges only fires on transitions', () => {
	const idle = assembleHostUpdates();
	const pkgs = assembleHostUpdates({ packages: 4, security: 1 });
	const installing = assembleHostUpdates({ packages: 4, packagesInstalling: true });
	const reboot = assembleHostUpdates({ rebootRequired: true, rebootPkgs: ['linux'] });
	assert.deepEqual(hostUpdateChanges(idle, pkgs), ['available']);
	assert.deepEqual(hostUpdateChanges(pkgs, pkgs), []);
	assert.deepEqual(hostUpdateChanges(pkgs, installing), ['install-start']);
	assert.deepEqual(hostUpdateChanges(installing, pkgs), ['install-end']);
	assert.deepEqual(hostUpdateChanges(installing, reboot), ['reboot']);
	assert.deepEqual(hostUpdateChanges(idle, reboot), ['reboot']);
});

test('hostUpdateNotifies uses apt and fwupd copy, not git', () => {
	const idle = assembleHostUpdates();
	const pkgs = assembleHostUpdates({ packages: 3, security: 1 });
	const [msg] = hostUpdateNotifies(idle, pkgs);
	assert.equal(msg.title, 'Package updates');
	assert.equal(msg.body, '3 packages, 1 security');
	assert.equal(msg.source, 'apt');
	assert.equal(msg.kind, 'update');
	assert.equal(updateAvailableNotify({ firmware: 1, firmwareNames: ['Dock'] }).title, 'Firmware update');
	assert.equal(installInProgressNotify({ firmwareInstalling: true }).title, 'Installing firmware');
});

test('getHostUpdates reads apt-check and fwupd, never apt-get update', async () => {
	const calls = [];
	const run = (bin, args = []) => {
		calls.push([bin, ...args].join(' '));
		if (String(bin).endsWith('apt-check')) return '5;2';
		if (bin === 'fwupdmgr') {
			return JSON.stringify({
				Devices: [{ Name: 'System Firmware', Releases: [{ Version: '1.2.3' }] }]
			});
		}
		return '';
	};
	const snap = await getHostUpdates({
		run,
		exists: (file) => String(file).endsWith('apt-check'),
		read: () => '',
		now: 1,
		force: true,
		state: { cache: null }
	});
	assert.equal(snap.packages, 5);
	assert.equal(snap.security, 2);
	assert.equal(snap.firmware, 1);
	assert.equal(snap.firmwareNames[0], 'System Firmware');
	assert.equal(snap.available, true);
	assert.ok(calls.some((line) => line.includes('apt-check')));
	assert.ok(calls.some((line) => line.startsWith('fwupdmgr get-updates --json')));
	assert.equal(
		calls.some((line) => /\bapt-get\b/.test(line) && /\bupdate\b/.test(line)),
		false
	);
});

test('getHostUpdates caches apt and firmware across cheap polls', async () => {
	let fw = 0;
	const run = (bin) => {
		if (bin === 'fwupdmgr') {
			fw += 1;
			return '{"Devices":[]}';
		}
		if (String(bin).endsWith('apt-check')) return '0;0';
		return '';
	};
	const io = {
		run,
		exists: (file) => String(file).endsWith('apt-check'),
		read: () => '',
		now: 1000,
		state: { cache: null }
	};
	await getHostUpdates({ ...io, force: true });
	await getHostUpdates(io);
	assert.equal(fw, 1);
});

test('getHostUpdates treats a held dpkg lock as installing packages', async () => {
	const snap = await getHostUpdates({
		run: (bin) => {
			if (bin === 'fuser') return '/var/lib/dpkg/lock-frontend:  4412';
			if (String(bin).endsWith('apt-check')) return '2;0';
			if (bin === 'fwupdmgr') return '{"Devices":[]}';
			return '';
		},
		exists: (file) => String(file).endsWith('apt-check'),
		read: () => '',
		now: 1,
		force: true,
		state: { cache: null }
	});
	assert.equal(snap.packagesInstalling, true);
	assert.equal(snap.installing, true);
	assert.equal(snap.firmwareInstalling, false);
});

test('getHostUpdates does not treat pgrep errors as an install', async () => {
	const snap = await getHostUpdates({
		run: (bin) => {
			if (bin === 'fuser') return 'fuser: command not found';
			if (bin === 'lsof') return '';
			if (bin === 'pgrep') return 'pgrep: unknown option';
			if (String(bin).endsWith('apt-check')) return '2;0';
			if (bin === 'fwupdmgr') return '{"Devices":[]}';
			return '';
		},
		exists: (file) => String(file).endsWith('apt-check'),
		read: () => '',
		now: 1,
		force: true,
		state: { cache: null }
	});
	assert.equal(snap.packagesInstalling, false);
	assert.equal(snap.installing, false);
	assert.equal(snap.available, true);
});
