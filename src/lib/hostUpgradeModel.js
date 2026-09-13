/** Pure apt / fwupd install-progress helpers. Safe to import from the kiosk UI. */

export const EMPTY_INSTALL_PROGRESS = {
	type: 'installProgress',
	active: false,
	phase: 'idle',
	title: '',
	current: '',
	lastCompleted: '',
	completed: [],
	done: 0,
	total: 0,
	percent: 0,
	error: ''
};

export const INSTALL_BEAD_MAX = 16;

function clipPkg(name) {
	return String(name || '')
		.replace(/:.*$/, '')
		.trim()
		.slice(0, 80);
}

export function parseUpgradeLine(line = '') {
	const text = String(line || '')
		.replace(/\r/g, '')
		.trim();
	if (!text) return null;

	const pm = text.match(/^pmstatus:([^:]*):([0-9.]+):(.*)$/i);
	if (pm) {
		return {
			kind: 'pmstatus',
			pkg: clipPkg(pm[1]),
			fraction: Number(pm[2]) || 0,
			message: String(pm[3] || '').trim()
		};
	}
	const dl = text.match(/^dlstatus:([^:]*):([0-9.]+):(.*)$/i);
	if (dl) {
		return {
			kind: 'dlstatus',
			pkg: clipPkg(dl[1]),
			fraction: Number(dl[2]) || 0,
			message: String(dl[3] || '').trim()
		};
	}
	const fancy = text.match(/Progress:\s*\[\s*(\d+)\s*%/i);
	if (fancy) return { kind: 'percent', percent: Number(fancy[1]) };

	const setting = text.match(/^Setting up ([a-z0-9][a-z0-9.+-]+)/i);
	if (setting) return { kind: 'complete', pkg: clipPkg(setting[1]) };

	const unpacking = text.match(/^Unpacking ([a-z0-9][a-z0-9.+-]+)/i);
	if (unpacking) return { kind: 'current', pkg: clipPkg(unpacking[1]) };

	const preparing = text.match(/Preparing to unpack .*\/([a-z0-9][a-z0-9.+-]+)[_:]/i);
	if (preparing) return { kind: 'current', pkg: clipPkg(preparing[1]) };

	const fwDone = text.match(/^Successfully installed\s+(.+)$/i) || text.match(/^Deployed\s+(.+)$/i);
	if (fwDone) return { kind: 'complete', pkg: clipPkg(fwDone[1]) };

	if (/^Updating\s+/i.test(text) || /^Decompressing/i.test(text) || /^Downloading/i.test(text)) {
		const name = text.replace(/^[A-Za-z ]+\s+/, '').replace(/\.+$/, '').trim();
		const pct = text.match(/(\d+)\s*%/);
		return {
			kind: pct ? 'percent' : 'current',
			pkg: clipPkg(name),
			percent: pct ? Number(pct[1]) : undefined
		};
	}
	return null;
}

export function installPhaseTitle(phase = 'packages') {
	if (phase === 'firmware') return 'Installing firmware';
	if (phase === 'done') return 'Packages updated';
	if (phase === 'error') return 'Update failed';
	return 'Installing packages';
}

/** Compact Dynamic Island Live Activity while the satellite orb shows progress. */
export function islandActivityForProgress(progress) {
	if (!progress?.active) return null;
	const total = Number(progress.total) || 0;
	const done = Number(progress.done) || 0;
	const body =
		total > 0 ? `${done}/${total}` : progress.current || progress.lastCompleted || '';
	return {
		kind: 'install',
		title: progress.title || installPhaseTitle(progress.phase),
		body,
		severity: progress.phase === 'error' ? 'warn' : progress.phase === 'done' ? 'ok' : 'info'
	};
}

export function applyUpgradeEvent(prev = EMPTY_INSTALL_PROGRESS, event = null) {
	const next = {
		...EMPTY_INSTALL_PROGRESS,
		...prev,
		completed: Array.isArray(prev?.completed) ? [...prev.completed] : []
	};
	if (!event) return next;
	next.active = true;
	if (event.kind === 'current' && event.pkg) {
		next.current = event.pkg;
	}
	if (event.kind === 'complete' && event.pkg) {
		if (!next.completed.includes(event.pkg)) {
			next.completed.push(event.pkg);
			if (next.completed.length > 24) next.completed = next.completed.slice(-24);
		}
		next.done = next.total > 0 ? Math.min(next.total, next.completed.length) : next.completed.length;
		next.lastCompleted = event.pkg;
		next.current = event.pkg;
	}
	if (event.kind === 'pmstatus') {
		if (event.pkg) next.current = event.pkg;
		if (event.fraction >= 0) next.percent = Math.round(event.fraction * 100);
	}
	if (event.kind === 'dlstatus') {
		next.current = event.pkg || event.message || next.current;
		if (event.fraction >= 0) next.percent = Math.max(next.percent, Math.round(event.fraction * 50));
	}
	if (event.kind === 'percent' && Number.isFinite(event.percent)) {
		next.percent = event.percent;
	}
	if (next.total > 0 && next.done >= 0) {
		next.percent = Math.max(next.percent, Math.round((next.done / next.total) * 100));
	}
	if (next.percent >= 0) next.percent = Math.min(100, next.percent);
	return next;
}

export function beginInstallProgress({ phase = 'packages', total = 0, current = '' } = {}) {
	return {
		...EMPTY_INSTALL_PROGRESS,
		active: true,
		phase,
		title: installPhaseTitle(phase),
		current,
		total: Math.max(0, Number(total) || 0),
		percent: total > 0 ? 0 : -1
	};
}

export function finishInstallProgress(prev, { error = '' } = {}) {
	if (error) {
		return {
			...prev,
			active: true,
			phase: 'error',
			title: installPhaseTitle('error'),
			error: String(error).slice(0, 160),
			percent: prev?.percent >= 0 ? prev.percent : 0
		};
	}
	return {
		...prev,
		active: true,
		phase: 'done',
		title: installPhaseTitle('done'),
		current: prev?.lastCompleted || prev?.current || '',
		percent: 100,
		error: ''
	};
}

export function installBeads(percent, total = 0, max = INSTALL_BEAD_MAX) {
	const count = total > 0 ? Math.min(max, Math.max(1, total)) : max;
	if (!(percent >= 0)) return Array.from({ length: count }, () => false);
	const filled = Math.round((Math.min(100, percent) / 100) * count);
	return Array.from({ length: count }, (_, i) => i < filled);
}

export function mirrorExternalInstall(snapshot = {}) {
	const firmwareOnly = snapshot.firmwareInstalling && !snapshot.packagesInstalling;
	const phase = firmwareOnly ? 'firmware' : 'packages';
	return {
		...beginInstallProgress({
			phase,
			total: firmwareOnly ? snapshot.firmware || 0 : snapshot.packages || 0,
			current: firmwareOnly ? snapshot.firmwareNames?.[0] || '' : ''
		}),
		percent: -1
	};
}
