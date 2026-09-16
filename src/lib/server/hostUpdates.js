import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

const execFileAsync = promisify(execFile);

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

// Async (not spawnSync) so probing apt/fwupd/dpkg-lock doesn't freeze the
// whole server's event loop while it runs - see kioskStatus.js for the
// fuller note. The various probes below also now run concurrently via
// Promise.all instead of one after another.
async function defaultRun(bin, args = [], timeout = 3000) {
	try {
		const { stdout, stderr } = await execFileAsync(bin, args, { encoding: 'utf8', timeout });
		return `${stdout || ''}\n${stderr || ''}`.trim();
	} catch (error) {
		return `${error?.stdout || ''}\n${error?.stderr || ''}`.trim();
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

async function probeInstalling({ run }) {
	const [fuserText, lsofText, ...pgrepHits] = await Promise.all([
		run('fuser', [DPKG_LOCK], LOCK_MS),
		run('lsof', [DPKG_LOCK], LOCK_MS),
		run('pgrep', ['-x', 'apt-get'], LOCK_MS),
		run('pgrep', ['-x', 'dpkg'], LOCK_MS),
		run('pgrep', ['-x', 'unattended-upgr'], LOCK_MS),
		run('pgrep', ['-x', 'unattended-upgrade'], LOCK_MS),
		run('pgrep', ['-a', 'fwupdmgr'], LOCK_MS)
	]);
	const packagesInstalling =
		parseLockHolder(fuserText || lsofText) || pgrepHits.slice(0, 4).some((hit) => parsePgrepHit(hit));
	const firmwareInstalling = parseFwupdProcessList(pgrepHits[4]);
	return { packagesInstalling, firmwareInstalling };
}

function probeReboot({ exists, read }) {
	return {
		rebootRequired: exists(REBOOT_REQUIRED),
		rebootPkgs: parseRebootPkgs(read(REBOOT_PKGS))
	};
}

async function probeApt({ run, exists, read }) {
	if (exists(APT_CHECK)) {
		const parsed = parseAptCheck(await run(APT_CHECK, [], APT_CHECK_MS));
		if (parsed) return { ...parsed, source: 'apt-check' };
	}
	if (exists(UPDATES_AVAILABLE)) {
		const parsed = parseUpdateNotifier(read(UPDATES_AVAILABLE));
		if (parsed) return { ...parsed, source: 'update-notifier' };
	}
	const listed = parseAptListUpgradable(await run('apt', ['-qq', 'list', '--upgradable'], APT_LIST_MS));
	if (listed.packages > 0) return { ...listed, source: 'apt-list' };
	return { packages: 0, security: 0, source: 'none' };
}

async function probeFirmware({ run }) {
	const raw = await run('fwupdmgr', ['get-updates', '--json'], FWUPD_MS);
	const json = parseFwupdJson(raw);
	if (json) return { count: json.count, names: json.names, source: 'fwupd' };
	const text = parseFwupdText(raw);
	return { count: text.count, names: text.names, source: raw ? 'fwupd' : 'none' };
}

/** Read cached apt lists and fwupd. Does not run `apt-get update`. */
export async function getHostUpdates(io = {}) {
	const now = io.now ?? Date.now();
	const run = io.run || defaultRun;
	const exists = io.exists || existsSync;
	const read = io.read || defaultRead;
	const force = Boolean(io.force);
	const state = io.state || GLOBAL;
	const ttl = Number.isFinite(io.ttlMs) ? io.ttlMs : APT_TTL_MS;
	const cached = state.cache;
	const canUseCache = cached && !force && now - cached.at < ttl;

	const [installing, reboot] = await Promise.all([
		probeInstalling({ run }),
		probeReboot({ exists, read }),
		canUseCache
			? null
			: Promise.all([probeApt({ run, exists, read }), probeFirmware({ run })]).then(
					([apt, firmware]) => {
						state.cache = { at: now, apt, firmware };
					}
				)
	]);
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
