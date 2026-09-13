import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { scriptPath } from './displayPower.js';
import { resetHostUpdatesCache } from './hostUpdates.js';
import {
	EMPTY_INSTALL_PROGRESS,
	applyUpgradeEvent,
	beginInstallProgress,
	finishInstallProgress,
	mirrorExternalInstall,
	parseUpgradeLine
} from '../hostUpgradeModel.js';
import { parseAptListNames } from '../hostUpdatesModel.js';

const BOOT_GRACE_MS = 120_000;
const FAIL_BACKOFF_MS = 30 * 60 * 1000;
const DONE_HOLD_MS = 4200;

function defaultScript() {
	return process.env.HOST_UPGRADE_BIN || scriptPath('host-upgrade.sh');
}

function lineSplitter(onLine) {
	let buf = '';
	return (chunk) => {
		buf += String(chunk || '');
		const parts = buf.split(/\n/);
		buf = parts.pop() || '';
		for (const part of parts) onLine(part);
	};
}

export function createHostUpgrade(io = {}) {
	const bootAt = io.bootAt ?? Date.now();
	let progress = { ...EMPTY_INSTALL_PROGRESS };
	let child = null;
	let queue = [];
	let plan = { packages: 0, firmware: 0, firmwareNames: [] };
	let lastFailAt = 0;
	let doneTimer = 0;
	let listener = io.onChange || (() => {});

	function publish(next) {
		progress = next;
		listener(progress);
	}

	function ourJob() {
		return Boolean(child) || (progress.active && progress.phase !== 'idle' && progress.percent !== -1);
	}

	function finishSoon(next) {
		publish(next);
		clearTimeout(doneTimer);
		doneTimer = setTimeout(() => {
			child = null;
			queue = [];
			publish({ ...EMPTY_INSTALL_PROGRESS });
		}, io.doneHoldMs ?? DONE_HOLD_MS);
	}

	function listPackageCount() {
		if (typeof io.runList === 'function') {
			const names = parseAptListNames(io.runList() || '');
			if (names.length) return names.length;
		}
		return Number(plan.packages) || 0;
	}

	function stepTotal(step) {
		if (step === 'firmware') {
			return Number(plan.firmware) || plan.firmwareNames?.length || 0;
		}
		return listPackageCount();
	}

	function runStep(step) {
		const script = io.script || defaultScript();
		const spawnFn = io.spawn || spawn;
		const total = stepTotal(step);
		publish(beginInstallProgress({ phase: step, total }));

		let proc;
		try {
			proc = io.noSudo
				? spawnFn(script, [step], spawnEnv())
				: spawnFn(io.sudoBin || 'sudo', ['-n', script, step], spawnEnv());
		} catch (error) {
			lastFailAt = now();
			finishSoon(finishInstallProgress(progress, { error: error.message || 'spawn failed' }));
			return;
		}

		child = proc;
		let settled = false;
		let errText = '';
		const feed = lineSplitter((line) => {
			const event = parseUpgradeLine(line);
			if (event) publish(applyUpgradeEvent(progress, event));
		});
		proc.stdout?.on('data', (chunk) => feed(chunk));
		proc.stderr?.on('data', (chunk) => {
			errText += String(chunk || '');
			feed(chunk);
		});

		const settle = (fn) => {
			if (settled) return;
			settled = true;
			child = null;
			fn();
		};

		proc.on('error', (error) => {
			settle(() => {
				lastFailAt = now();
				finishSoon(finishInstallProgress(progress, { error: error.message || 'upgrade failed' }));
			});
		});
		proc.on('close', (code) => {
			settle(() => {
				if (code) {
					lastFailAt = now();
					const needSudo = /password is required|a terminal is required|sudo:/i.test(errText);
					finishSoon(
						finishInstallProgress(progress, {
							error: needSudo
								? 'Need passwordless sudo for host-upgrade.sh'
								: `upgrade exited ${code}`
						})
					);
					return;
				}
				const next = queue.shift();
				if (next) {
					runStep(next);
					return;
				}
				if (typeof io.resetCache === 'function') io.resetCache();
				else resetHostUpdatesCache();
				finishSoon(finishInstallProgress(progress));
			});
		});
	}

	function spawnEnv() {
		return {
			env: {
				...process.env,
				DEBIAN_FRONTEND: 'noninteractive',
				APT_LISTCHANGES_FRONTEND: 'none',
				NEEDRESTART_MODE: 'l'
			}
		};
	}

	function now() {
		return io.now?.() ?? Date.now();
	}

	function start(snapshot) {
		plan = {
			packages: Number(snapshot.packages) || 0,
			firmware: Number(snapshot.firmware) || 0,
			firmwareNames: snapshot.firmwareNames || []
		};
		queue = [];
		if (plan.packages > 0) queue.push('packages');
		if (plan.firmware > 0) queue.push('firmware');
		if (!queue.length) return false;
		runStep(queue.shift());
		return true;
	}

	function maybeStart(snapshot, opts = {}) {
		if (!snapshot) return false;
		if (child) return false;
		if (opts.lockHeld) return false;
		if (snapshot.installing && !ourJob()) {
			publish(mirrorExternalInstall(snapshot));
			return false;
		}
		if (snapshot.installing) return false;
		if (!snapshot.available) {
			if (progress.active && progress.percent === -1 && !child) {
				publish({ ...EMPTY_INSTALL_PROGRESS });
			}
			return false;
		}
		if (ourJob()) return false;
		if (now() - bootAt < (io.bootGraceMs ?? BOOT_GRACE_MS) && !opts.force) return false;
		if (lastFailAt && now() - lastFailAt < (io.failBackoffMs ?? FAIL_BACKOFF_MS) && !opts.force) {
			return false;
		}
		const script = io.script || defaultScript();
		if (!io.spawn && !existsSync(script)) return false;
		return start(snapshot);
	}

	return {
		maybeStart,
		getProgress: () => progress,
		reset() {
			if (child && typeof child.kill === 'function') child.kill();
			child = null;
			queue = [];
			clearTimeout(doneTimer);
			publish({ ...EMPTY_INSTALL_PROGRESS });
		},
		setListener(fn) {
			listener = fn || (() => {});
		}
	};
}

const hostUpgrade = createHostUpgrade();

export function maybeStartHostUpgrade(snapshot, opts) {
	return hostUpgrade.maybeStart(snapshot, opts);
}

export function getInstallProgress() {
	return hostUpgrade.getProgress();
}

export function setInstallProgressListener(fn) {
	hostUpgrade.setListener(fn);
}

export { EMPTY_INSTALL_PROGRESS };
