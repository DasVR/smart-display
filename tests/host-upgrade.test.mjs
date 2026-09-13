import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
	EMPTY_INSTALL_PROGRESS,
	applyUpgradeEvent,
	beginInstallProgress,
	finishInstallProgress,
	installBeads,
	islandActivityForProgress,
	parseUpgradeLine
} from '../src/lib/hostUpgradeModel.js';
import { parseAptListNames } from '../src/lib/hostUpdatesModel.js';
import { createHostUpgrade } from '../src/lib/server/hostUpgrade.js';
import { assembleHostUpdates } from '../src/lib/hostUpdatesModel.js';

test('parseUpgradeLine reads apt status-fd and setting-up rows', () => {
	assert.deepEqual(parseUpgradeLine('pmstatus:curl:0.4500:Installing curl'), {
		kind: 'pmstatus',
		pkg: 'curl',
		fraction: 0.45,
		message: 'Installing curl'
	});
	assert.deepEqual(parseUpgradeLine('Setting up curl (8.5.0-2ubuntu10.6) ...'), {
		kind: 'complete',
		pkg: 'curl'
	});
	assert.deepEqual(parseUpgradeLine('Unpacking linux-generic (6.8.0-71.71) over (6.8.0-60.63) ...'), {
		kind: 'current',
		pkg: 'linux-generic'
	});
	assert.equal(parseUpgradeLine('Preparing to unpack .../curl_8.5.0_amd64.deb ...').pkg, 'curl');
	assert.equal(parseUpgradeLine('Progress: [ 40%]').percent, 40);
	assert.equal(parseUpgradeLine('hello'), null);
});

test('applyUpgradeEvent counts completions and never goes past 100', () => {
	let state = beginInstallProgress({ phase: 'packages', total: 2 });
	state = applyUpgradeEvent(state, { kind: 'complete', pkg: 'curl' });
	state = applyUpgradeEvent(state, { kind: 'complete', pkg: 'curl' });
	state = applyUpgradeEvent(state, { kind: 'complete', pkg: 'libc6' });
	assert.equal(state.done, 2);
	assert.equal(state.percent, 100);
	assert.equal(state.lastCompleted, 'libc6');
	assert.deepEqual(state.completed, ['curl', 'libc6']);
});

test('installBeads fill by percent, empty when unknown', () => {
	assert.deepEqual(installBeads(-1, 0, 4), [false, false, false, false]);
	assert.equal(installBeads(50, 8, 8).filter(Boolean).length, 4);
	assert.equal(installBeads(100, 40, 16).filter(Boolean).length, 16);
});

test('islandActivityForProgress keeps a compact island while the orb is busy', () => {
	assert.equal(islandActivityForProgress({ ...EMPTY_INSTALL_PROGRESS }), null);
	let state = beginInstallProgress({ phase: 'packages', total: 5 });
	state = applyUpgradeEvent(state, { kind: 'complete', pkg: 'curl' });
	assert.deepEqual(islandActivityForProgress(state), {
		kind: 'install',
		title: 'Installing packages',
		body: '1/5',
		severity: 'info'
	});
	assert.equal(islandActivityForProgress(finishInstallProgress(state)).severity, 'ok');
});

test('parseAptListNames reads the package before the slash', () => {
	const names = parseAptListNames(
		'curl/noble-updates 8.5.0 amd64 [upgradable from: 8.4.0]\nlinux-generic/noble 6.8 [upgradable from: 6.7]\n'
	);
	assert.deepEqual(names, ['curl', 'linux-generic']);
});

test('createHostUpgrade streams apt lines and finishes', async () => {
	const seen = [];
	const upgrade = createHostUpgrade({
		bootAt: 0,
		bootGraceMs: 0,
		doneHoldMs: 20,
		resetCache: () => {},
		onChange: (p) => seen.push(p),
		spawn: () => {
			const proc = new EventEmitter();
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();
			queueMicrotask(() => {
				proc.stderr.emit('data', 'Setting up curl (1) ...\n');
				proc.stderr.emit('data', 'Setting up libc6 (1) ...\n');
				proc.emit('close', 0);
			});
			return proc;
		}
	});
	const started = upgrade.maybeStart(
		assembleHostUpdates({ packages: 2, security: 0 }),
		{ force: true, now: 999999 }
	);
	assert.equal(started, true);
	await new Promise((r) => setTimeout(r, 8));
	assert.equal(upgrade.getProgress().phase, 'done');
	assert.ok(seen.some((p) => p.lastCompleted === 'libc6'));
	assert.equal(finishInstallProgress(beginInstallProgress({ total: 1 })).percent, 100);
});

test('createHostUpgrade still starts when dpkg already holds the lock', () => {
	const calls = [];
	const upgrade = createHostUpgrade({
		bootAt: 0,
		bootGraceMs: 0,
		doneHoldMs: 20,
		resetCache: () => {},
		runList: () => 'curl/noble 1 [upgradable from: 0]\n',
		spawn: (bin, args) => {
			calls.push([bin, ...args].join(' '));
			const proc = new EventEmitter();
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();
			queueMicrotask(() => proc.emit('close', 0));
			return proc;
		}
	});
	const started = upgrade.maybeStart(
		assembleHostUpdates({ packages: 2, packagesInstalling: true }),
		{ force: true }
	);
	assert.equal(started, true);
	assert.equal(calls.length, 1);
});

test('createHostUpgrade kills a stalled apt so installing cannot stick', async () => {
	let killed = false;
	const upgrade = createHostUpgrade({
		bootAt: 0,
		bootGraceMs: 0,
		doneHoldMs: 15,
		stallMs: 20,
		resetCache: () => {},
		spawn: () => {
			const proc = new EventEmitter();
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();
			proc.kill = () => {
				killed = true;
			};
			return proc;
		}
	});
	assert.equal(
		upgrade.maybeStart(assembleHostUpdates({ packages: 1 }), { force: true }),
		true
	);
	assert.equal(upgrade.getProgress().active, true);
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(killed, true);
	assert.equal(upgrade.getProgress().phase, 'error');
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(upgrade.getProgress().active, false);
});

test('createHostUpgrade waits for boot grace and does not spawn apt-get update', () => {
	const calls = [];
	const upgrade = createHostUpgrade({
		bootAt: 1000,
		bootGraceMs: 120000,
		now: () => 2000,
		spawn: (bin, args) => {
			calls.push([bin, ...args].join(' '));
			const proc = new EventEmitter();
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();
			queueMicrotask(() => proc.emit('close', 0));
			return proc;
		}
	});
	assert.equal(
		upgrade.maybeStart(assembleHostUpdates({ packages: 3 }), { now: 2000 }),
		false
	);
	assert.deepEqual(calls, []);
});
