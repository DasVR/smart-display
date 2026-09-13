import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
	assembleHostUpdates,
	parseAptCheck,
	parseAptListUpgradable,
	parseFwupdJson,
	parseFwupdProcessList,
	parseFwupdText,
	parseLockHolder,
	parsePgrepHit,
	parseRebootPkgs,
	parseUpdateNotifier
} from '../hostUpdatesModel.js';

const APT_CHECK = '/usr/lib/update-notifier/apt-check';
const UPDATES_AVAILABLE = '/var/lib/update-notifier/updates-available';
const DPKG_LOCK = '/var/lib/dpkg/lock-frontend';
const REBOOT_REQUIRED = '/var/run/reboot-required';
const REBOOT_PKGS = '/var/run/reboot-required.pkgs';
const APT_TTL_MS = 30 * 60 * 1000;
const APT_CHECK_MS = 8000;
const APT_LIST_MS = 10000;
const FWUPD_MS = 15000;
const LOCK_MS = 2000;

const GLOBAL = { cache: null };

function defaultRun(bin, args = [], timeout = 3000) {
	try {
		const result = spawnSync(bin, args, {
			encoding: 'utf8',
			timeout,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
	} catch {
		return '';
	}
}

function defaultRead(file) {
	try {
		if (!file || !existsSync(file)) return '';
		return readFileSync(file, 'utf8');
	} catch {
		return '';
	}
}

export function resetHostUpdatesCache(state = GLOBAL) {
	state.cache = null;
}

function probeInstalling({ run }) {
	const lockText = run('fuser', [DPKG_LOCK], LOCK_MS) || run('lsof', [DPKG_LOCK], LOCK_MS);
	let packagesInstalling = parseLockHolder(lockText);
	if (!packagesInstalling) {
		for (const name of ['apt-get', 'dpkg', 'unattended-upgr', 'unattended-upgrade']) {
			if (parsePgrepHit(run('pgrep', ['-x', name], LOCK_MS))) {
				packagesInstalling = true;
				break;
			}
		}
	}
	const firmwareInstalling = parseFwupdProcessList(run('pgrep', ['-a', 'fwupdmgr'], LOCK_MS));
	return { packagesInstalling, firmwareInstalling };
}

function probeReboot({ exists, read }) {
	return {
		rebootRequired: exists(REBOOT_REQUIRED),
		rebootPkgs: parseRebootPkgs(read(REBOOT_PKGS))
	};
}

function probeApt({ run, exists, read }) {
	if (exists(APT_CHECK)) {
		const parsed = parseAptCheck(run(APT_CHECK, [], APT_CHECK_MS));
		if (parsed) return { ...parsed, source: 'apt-check' };
	}
	if (exists(UPDATES_AVAILABLE)) {
		const parsed = parseUpdateNotifier(read(UPDATES_AVAILABLE));
		if (parsed) return { ...parsed, source: 'update-notifier' };
	}
	const listed = parseAptListUpgradable(run('apt', ['-qq', 'list', '--upgradable'], APT_LIST_MS));
	if (listed.packages > 0) return { ...listed, source: 'apt-list' };
	return { packages: 0, security: 0, source: 'none' };
}

function probeFirmware({ run }) {
	const raw = run('fwupdmgr', ['get-updates', '--json'], FWUPD_MS);
	const json = parseFwupdJson(raw);
	if (json) return { count: json.count, names: json.names, source: 'fwupd' };
	const text = parseFwupdText(raw);
	return { count: text.count, names: text.names, source: raw ? 'fwupd' : 'none' };
}

/** Read cached apt lists and fwupd. Does not run `apt-get update`. */
export function getHostUpdates(io = {}) {
	const now = io.now ?? Date.now();
	const run = io.run || defaultRun;
	const exists = io.exists || existsSync;
	const read = io.read || defaultRead;
	const force = Boolean(io.force);
	const state = io.state || GLOBAL;
	const installing = probeInstalling({ run });
	const reboot = probeReboot({ exists, read });
	const ttl = Number.isFinite(io.ttlMs) ? io.ttlMs : APT_TTL_MS;
	const cached = state.cache;
	const canUseCache = cached && !force && now - cached.at < ttl;
	if (!canUseCache) {
		const apt = probeApt({ run, exists, read });
		const firmware = probeFirmware({ run });
		state.cache = { at: now, apt, firmware };
	}
	const apt = state.cache?.apt || { packages: 0, security: 0, source: 'none' };
	const firmware = state.cache?.firmware || { count: 0, names: [], source: 'none' };
	const source =
		[apt.source, firmware.source].filter((s) => s && s !== 'none').join('+') || 'none';
	return assembleHostUpdates({
		packages: apt.packages,
		security: apt.security,
		firmware: firmware.count,
		firmwareNames: firmware.names,
		packagesInstalling: installing.packagesInstalling,
		firmwareInstalling: installing.firmwareInstalling,
		rebootRequired: reboot.rebootRequired,
		rebootPkgs: reboot.rebootPkgs,
		source
	});
}
