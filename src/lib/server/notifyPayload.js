export const NOTIFY_SEVERITIES = new Set(['info', 'ok', 'warn', 'error']);
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

/** Build the WebSocket `notify` frame from a POST /api/notify body.
 *  `event: "done"` fills in `{source} finished` when title is omitted. */
export function parseNotifyPayload(data = {}) {
	const event = String(data.event || '')
		.trim()
		.toLowerCase();
	const source = clip(data.source, 40);
	let title = clip(data.title, 120).trim();
	const body = clip(data.body, 240);

	if (!title && event === 'done') {
		title = source ? `${source} finished` : 'Agent finished';
	}

	if (!title) {
		return { error: 'title required', status: 400 };
	}

	const severity = NOTIFY_SEVERITIES.has(data.severity)
		? data.severity
		: event === 'done'
			? 'ok'
			: 'info';

	return {
		notify: {
			type: 'notify',
			title,
			body,
			severity,
			source,
			ttl: clampTtl(data.ttl)
		}
	};
}

export function bluetoothConnectedNotify(name = '') {
	const trimmed = clip(name, 80).trim();
	return {
		type: 'notify',
		title: trimmed ? `${trimmed} connected` : 'Phone connected',
		body: 'Music ready',
		severity: 'ok',
		source: 'Bluetooth',
		ttl: DEFAULT_NOTIFY_TTL
	};
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

export function agentFinishedNotify() {
	return {
		type: 'notify',
		title: 'Agent finished',
		body: 'Local model is idle',
		severity: 'ok',
		source: 'Ollama',
		ttl: DEFAULT_NOTIFY_TTL
	};
}
