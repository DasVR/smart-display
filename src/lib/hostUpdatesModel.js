/** Pure apt / fwupd snapshot helpers. Safe to import from the kiosk UI. */

export const EMPTY_HOST_UPDATES = {
	packages: 0,
	security: 0,
	firmware: 0,
	firmwareNames: [],
	installing: false,
	packagesInstalling: false,
	firmwareInstalling: false,
	rebootRequired: false,
	rebootPkgs: [],
	available: false,
	source: 'none'
};

export function parseAptCheck(text = '') {
	const m = String(text || '').match(/(\d+)\s*;\s*(\d+)/);
	if (!m) return null;
	return {
		packages: parseInt(m[1], 10) || 0,
		security: parseInt(m[2], 10) || 0
	};
}

export function parseAptListUpgradable(text = '') {
	const names = parseAptListNames(text);
	return { packages: names.length, security: 0 };
}

export function parseAptListNames(text = '') {
	const names = [];
	for (const line of String(text || '').split('\n')) {
		if (!/\[upgradable from:/i.test(line)) continue;
		const name = line.split('/')[0].trim();
		if (name) names.push(name);
	}
	return names;
}

export function parseUpdateNotifier(text = '') {
	const raw = String(text || '');
	const packagesMatch =
		raw.match(/(\d+)\s+updates? can be applied immediately/i) ||
		raw.match(/(\d+)\s+packages? can be updated/i);
	if (!packagesMatch) return null;
	const securityMatch =
		raw.match(/(\d+)\s+of these updates are security updates/i) ||
		raw.match(/(\d+)\s+updates? are security updates/i);
	return {
		packages: parseInt(packagesMatch[1], 10) || 0,
		security: securityMatch ? parseInt(securityMatch[1], 10) || 0 : 0
	};
}

export function parseFwupdJson(raw = '') {
	const text = String(raw || '').trim();
	const obj = text.indexOf('{');
	const arr = text.indexOf('[');
	const start = obj === -1 ? arr : arr === -1 ? obj : Math.min(obj, arr);
	if (start < 0) return null;
	let data;
	try {
		data = JSON.parse(text.slice(start));
	} catch {
		return null;
	}
	const devices = Array.isArray(data) ? data : data?.Devices;
	if (!Array.isArray(devices)) return { count: 0, names: [] };
	const names = [];
	for (const device of devices) {
		const releases = device?.Releases || device?.releases;
		if (Array.isArray(releases) && releases.length === 0) continue;
		const name = String(device?.Name || device?.name || '').trim();
		if (name || (Array.isArray(releases) && releases.length)) {
			names.push(name || 'Firmware');
		}
	}
	return { count: names.length, names };
}

export function parseFwupdText(text = '') {
	const raw = String(text || '');
	if (!raw.trim()) return { count: 0, names: [] };
	if (/no updates available/i.test(raw) && !/upgrade from/i.test(raw)) {
		return { count: 0, names: [] };
	}
	const names = [];
	for (const line of raw.split('\n')) {
		const selected = line.match(/^\s*Selected device:\s*(.+)$/i);
		if (selected) {
			names.push(selected[1].trim());
			continue;
		}
		if (/upgrade from/i.test(line) && !names.length) names.push('Firmware');
	}
	const upgrades = raw.match(/upgrade from/gi);
	const count = Math.max(names.length, upgrades ? upgrades.length : 0);
	if (!count) return { count: 0, names: [] };
	return { count, names: names.slice(0, count) };
}

export function parseFwupdProcessList(text = '') {
	return String(text || '')
		.split('\n')
		.some((line) => {
			if (!/\bfwupdmgr\b/.test(line)) return false;
			if (/\b(get-updates|get-devices|get-history|get-results)\b/.test(line)) return false;
			return /\b(install|update|upgrade|offline-update|local-install)\b/.test(line);
		});
}

export function parseLockHolder(text = '') {
	return /\d/.test(String(text || ''));
}

export function parseRebootPkgs(text = '') {
	return String(text || '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 8);
}

export function packageUpdateBody(snapshot = {}) {
	const pkg = Number(snapshot.packages) || 0;
	const sec = Number(snapshot.security) || 0;
	if (pkg <= 0) return '';
	const packages = pkg === 1 ? '1 package' : `${pkg} packages`;
	if (sec > 0) {
		const security = sec === 1 ? '1 security' : `${sec} security`;
		return `${packages}, ${security}`;
	}
	return packages;
}

export function assembleHostUpdates({
	packages = 0,
	security = 0,
	firmware = 0,
	firmwareNames = [],
	packagesInstalling = false,
	firmwareInstalling = false,
	rebootRequired = false,
	rebootPkgs = [],
	source = 'none'
} = {}) {
	const pkg = Math.max(0, Number(packages) || 0);
	const sec = Math.max(0, Number(security) || 0);
	const fw = Math.max(0, Number(firmware) || 0);
	const names = Array.isArray(firmwareNames)
		? firmwareNames.map((n) => String(n || '').trim()).filter(Boolean).slice(0, 6)
		: [];
	const pkgs = Array.isArray(rebootPkgs) ? rebootPkgs.map((n) => String(n || '').trim()).filter(Boolean).slice(0, 8) : [];
	return {
		packages: pkg,
		security: sec,
		firmware: fw,
		firmwareNames: names,
		installing: Boolean(packagesInstalling || firmwareInstalling),
		packagesInstalling: Boolean(packagesInstalling),
		firmwareInstalling: Boolean(firmwareInstalling),
		rebootRequired: Boolean(rebootRequired),
		rebootPkgs: pkgs,
		available: pkg > 0 || fw > 0,
		source: source || 'none'
	};
}

/** Persistent Dynamic Island Live Activity, or null when the box is current.
 *  Installing itself is the satellite orb under the island, not a Live Activity. */
export function islandActivityForUpdates(snapshot) {
	if (!snapshot) return null;
	if (snapshot.installing) return null;
	if (snapshot.rebootRequired) {
		return {
			kind: 'update',
			title: 'Restart needed',
			body: snapshot.rebootPkgs?.[0] || 'Finish applying updates',
			severity: 'warn'
		};
	}
	if (snapshot.available) {
		const pkg = snapshot.packages || 0;
		const fw = snapshot.firmware || 0;
		if (fw && !pkg) {
			return {
				kind: 'update',
				title: fw === 1 ? 'Firmware update' : 'Firmware updates',
				body: (snapshot.firmwareNames || []).slice(0, 2).join(', ') || 'Firmware is ready',
				severity: 'warn'
			};
		}
		if (fw && pkg) {
			return {
				kind: 'update',
				title: 'Updates available',
				body: `${packageUpdateBody(snapshot)}, plus firmware`,
				severity: 'warn'
			};
		}
		return {
			kind: 'update',
			title: 'Package updates',
			body: packageUpdateBody(snapshot),
			severity: 'warn'
		};
	}
	return null;
}

export function hostUpdateChanges(prev, next) {
	const before = prev || EMPTY_HOST_UPDATES;
	const after = next || EMPTY_HOST_UPDATES;
	if (!before.installing && after.installing) return ['install-start'];
	if (before.installing && !after.installing) {
		return [after.rebootRequired ? 'reboot' : 'install-end'];
	}
	if (!before.rebootRequired && after.rebootRequired) return ['reboot'];
	const prevAvail = (before.packages || 0) + (before.firmware || 0);
	const nextAvail = (after.packages || 0) + (after.firmware || 0);
	if (prevAvail === 0 && nextAvail > 0 && !after.installing) return ['available'];
	return [];
}
