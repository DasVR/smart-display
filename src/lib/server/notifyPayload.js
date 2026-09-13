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
	if (event === 'update') return severity === 'ok' ? 'Display updated' : 'Update available';
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

export function updateAvailableNotify(behind = 0) {
	const n = Number(behind) || 0;
	return {
		type: 'notify',
		title: 'Update available',
		body: n === 1 ? '1 commit behind master' : `${n} commits behind master`,
		severity: 'warn',
		source: 'Git',
		kind: 'update',
		ttl: DEFAULT_NOTIFY_TTL
	};
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
