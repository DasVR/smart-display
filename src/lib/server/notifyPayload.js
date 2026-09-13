import { hostUpdateChanges } from '../hostUpdatesModel.js';

export const NOTIFY_SEVERITIES = new Set(['info', 'ok', 'warn', 'error']);
export const NOTIFY_EVENTS = new Set(['done', 'install', 'update']);
export const DEFAULT_NOTIFY_TTL = 9000;
export const MIN_NOTIFY_TTL = 1000;
export const MAX_NOTIFY_TTL = 30000;

function clampTtl(value) {
	const n = Number(value);
	if (!Number.isFinite(n) || value === '' || value == null) return DEFAULT_NOTIFY_TTL;
	return Math.min(Math.max(n, MIN_NOTIFY_TTL), MAX_NOTIFY_TTL);
}

function clip(value, max) {
	return String(value || '').slice(0, max);
}

function defaultSeverity(event) {
	if (event === 'done') return 'ok';
	if (event === 'install') return 'info';
	if (event === 'update') return 'warn';
	return 'info';
}

function defaultTitle(event, source, severity) {
	if (event === 'done') return source ? `${source} finished` : 'Agent finished';
	if (event === 'install') return source ? `${source} installing` : 'Installing packages';
	if (event === 'update') return severity === 'ok' ? 'Packages updated' : 'Package updates';
	return '';
}

/** Build the WebSocket `notify` frame from a POST /api/notify body.
 *  Known `event` values fill a title when one is omitted: `done`, `install`,
 *  `update`. */
export function parseNotifyPayload(data = {}) {
	const event = String(data.event || '')
		.trim()
		.toLowerCase();
	const source = clip(data.source, 40);
	const body = clip(data.body, 240);
	const known = NOTIFY_EVENTS.has(event);
	const severity = NOTIFY_SEVERITIES.has(data.severity)
		? data.severity
		: defaultSeverity(event);
	let title = clip(data.title, 120).trim();
	if (!title && known) title = defaultTitle(event, source, severity);

	if (!title) {
		return { error: 'title required', status: 400 };
	}

	return {
		notify: {
			type: 'notify',
			title,
			body,
			severity,
			source,
			kind: known ? event : 'notice',
			ttl: clampTtl(data.ttl)
		}
	};
}

export function volumeNotify({ volume = 0, muted = false } = {}) {
	const pct = Math.round(Number(volume) * 100) || 0;
	return {
		type: 'notify',
		title: muted ? 'Muted' : `Volume ${pct}%`,
		body: '',
		severity: 'info',
		source: 'Volume',
		kind: 'volume',
		muted: Boolean(muted),
		ttl: 2500
	};
}

export function scheduleNotify({ enabled, offAt, onAt } = {}) {
	return {
		type: 'notify',
		title: enabled ? `Nights ${offAt || ''} to ${onAt || ''}`.trim() : 'Auto nights off',
		body: enabled ? 'Panel will follow this schedule' : 'Night schedule paused',
		severity: 'ok',
		source: 'Remote',
		kind: 'schedule',
		ttl: 5000
	};
}

function packageCountBody(snapshot = {}) {
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

export function updateAvailableNotify(snapshot = {}) {
	const pkg = Number(snapshot.packages) || 0;
	const fw = Number(snapshot.firmware) || 0;
	const names = Array.isArray(snapshot.firmwareNames) ? snapshot.firmwareNames : [];
	let title = 'Package updates';
	let body = packageCountBody(snapshot);
	let source = 'apt';
	if (fw && !pkg) {
		title = fw === 1 ? 'Firmware update' : 'Firmware updates';
		body = names.slice(0, 2).join(', ') || 'Firmware is ready';
		source = 'fwupd';
	} else if (fw && pkg) {
		title = 'Updates available';
		body = `${packageCountBody(snapshot)}, plus firmware`;
		source = 'System';
	}
	return {
		type: 'notify',
		title,
		body,
		severity: 'warn',
		source,
		kind: 'update',
		ttl: DEFAULT_NOTIFY_TTL
	};
}

export function installInProgressNotify(snapshot = {}) {
	const firmwareOnly = snapshot.firmwareInstalling && !snapshot.packagesInstalling;
	const both = snapshot.firmwareInstalling && snapshot.packagesInstalling;
	return {
		type: 'notify',
		title: firmwareOnly ? 'Installing firmware' : both ? 'Installing updates' : 'Installing packages',
		body: both ? 'Packages and firmware' : firmwareOnly ? snapshot.firmwareNames?.[0] || '' : '',
		severity: 'info',
		source: firmwareOnly ? 'fwupd' : both ? 'System' : 'apt',
		kind: 'install',
		ttl: DEFAULT_NOTIFY_TTL
	};
}

export function updatesFinishedNotify(prev = {}) {
	const firmwareOnly = prev.firmwareInstalling && !prev.packagesInstalling;
	const both = prev.firmwareInstalling && prev.packagesInstalling;
	return {
		type: 'notify',
		title: firmwareOnly ? 'Firmware updated' : both ? 'Updates installed' : 'Packages updated',
		body: '',
		severity: 'ok',
		source: firmwareOnly ? 'fwupd' : both ? 'System' : 'apt',
		kind: 'update',
		ttl: DEFAULT_NOTIFY_TTL
	};
}

export function rebootRequiredNotify(snapshot = {}) {
	const pkgs = Array.isArray(snapshot.rebootPkgs) ? snapshot.rebootPkgs : [];
	return {
		type: 'notify',
		title: 'Restart needed',
		body: pkgs[0] || 'Finish applying updates',
		severity: 'warn',
		source: 'System',
		kind: 'update',
		ttl: DEFAULT_NOTIFY_TTL
	};
}

export function hostUpdateNotifies(prev, next) {
	return hostUpdateChanges(prev, next).map((change) => {
		if (change === 'install-start') return installInProgressNotify(next);
		if (change === 'install-end') return updatesFinishedNotify(prev);
		if (change === 'reboot') return rebootRequiredNotify(next);
		return updateAvailableNotify(next);
	});
}

export function audioRouteConnectedNotify({ name = '', source = 'Bluetooth' } = {}) {
	const trimmed = clip(name, 80).trim();
	const src = clip(source, 40).trim() || 'Bluetooth';
	const isAirplay = src.toLowerCase() === 'airplay';
	return {
		type: 'notify',
		title: trimmed ? `${trimmed} connected` : isAirplay ? 'AirPlay connected' : 'Phone connected',
		body: isAirplay ? 'Apple Music can play here' : 'Music ready',
		severity: 'ok',
		source: src,
		ttl: DEFAULT_NOTIFY_TTL
	};
}

export function bluetoothConnectedNotify(name = '') {
	return audioRouteConnectedNotify({ name, source: 'Bluetooth' });
}

export function airplayConnectedNotify(name = '') {
	return audioRouteConnectedNotify({ name, source: 'AirPlay' });
}

export function parseBtConnectedPayload(raw) {
	let name = '';
	try {
		const text = String(raw || '').trim();
		if (text) {
			const data = JSON.parse(text);
			name = clip(data.name || data.alias || data.device || '', 80).trim();
		}
	} catch {
		/* empty or non-JSON bodies still mean "a phone connected" */
	}
	return { name, notify: bluetoothConnectedNotify(name) };
}

export function parseAirplayConnectedPayload(raw) {
	let name = '';
	try {
		const text = String(raw || '').trim();
		if (text) {
			const data = JSON.parse(text);
			name = clip(data.name || data.alias || data.device || '', 80).trim();
		}
	} catch {
		/* empty or non-JSON bodies still mean AirPlay started */
	}
	return { name, notify: airplayConnectedNotify(name) };
}

export function agentFinishedNotify() {
	return {
		type: 'notify',
		title: 'Agent finished',
		body: 'Local model is idle',
		severity: 'ok',
		source: 'Ollama',
		kind: 'done',
		ttl: DEFAULT_NOTIFY_TTL
	};
}
