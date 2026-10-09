/**
 * Server side of chores / jobs / alerts: the JSON store, optional bearer
 * auth for the HTTP API, and outgoing webhooks for other platforms.
 *
 * Files (under data/, both git-ignored):
 *   tasks.json     the task list
 *   webhooks.json  subscribers: [{ id, url, events, secret }]
 *   api-token      optional bearer token (or set DISPLAY_API_TOKEN)
 *
 * With no token configured the HTTP API is open to the LAN, like the rest of
 * this server's API. Once a token exists, every /api/tasks and /api/webhooks
 * request needs `Authorization: Bearer <token>`. The kiosk and the phone
 * remote don't use HTTP for tasks; they go over the existing /ws socket.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const WEBHOOK_EVENTS = ['task.created', 'task.updated', 'task.deleted', 'task.due', 'task.done'];

function readJson(file, fallback) {
	try {
		if (!existsSync(file)) return fallback;
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/** Write via a temp file + rename so a crash mid-write can't truncate it. */
function writeJsonAtomic(file, value) {
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, file);
}

export function loadTasks(file) {
	const data = readJson(file, { tasks: [] });
	return Array.isArray(data?.tasks) ? data.tasks : [];
}

export function saveTasks(file, tasks) {
	writeJsonAtomic(file, { version: 1, tasks });
}

export function newTaskId() {
	return randomUUID().slice(0, 8);
}

/* ---------- auth ---------- */

export function loadApiToken(file, env = process.env) {
	const fromEnv = String(env.DISPLAY_API_TOKEN || '').trim();
	if (fromEnv) return fromEnv;
	try {
		if (existsSync(file)) return readFileSync(file, 'utf8').trim() || '';
	} catch {
		/* unreadable token file: treat as unset */
	}
	return '';
}

export function mintApiToken(file) {
	const token = randomBytes(24).toString('base64url');
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${token}\n`, { mode: 0o600 });
	return token;
}

/** True when the request may use the API: no token set, or a matching bearer. */
export function authorized(headers, token) {
	if (!token) return true;
	const header = String(headers?.authorization || '');
	const m = /^Bearer\s+(.+)$/i.exec(header);
	if (!m) return false;
	const a = Buffer.from(m[1].trim());
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- webhooks ---------- */

export function loadWebhooks(file) {
	const data = readJson(file, { webhooks: [] });
	return Array.isArray(data?.webhooks) ? data.webhooks : [];
}

export function saveWebhooks(file, hooks) {
	writeJsonAtomic(file, { version: 1, webhooks: hooks });
}

/** Validate a subscriber; returns { hook } or { error }. */
export function normalizeWebhook(input = {}) {
	let url;
	try {
		url = new URL(String(input.url || ''));
	} catch {
		return { error: 'url must be an absolute http(s) URL' };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'url must be http or https' };
	const events = Array.isArray(input.events) && input.events.length ? input.events : WEBHOOK_EVENTS;
	const bad = events.filter((e) => !WEBHOOK_EVENTS.includes(e));
	if (bad.length) return { error: `unknown events: ${bad.join(', ')} (allowed: ${WEBHOOK_EVENTS.join(', ')})` };
	return {
		hook: {
			id: newTaskId(),
			url: url.toString(),
			events: [...new Set(events)],
			name: String(input.name || '').slice(0, 40),
			secret: typeof input.secret === 'string' && input.secret ? input.secret.slice(0, 200) : ''
		}
	};
}

/** Hide secrets when listing subscribers back to a caller. */
export function publicWebhook(hook) {
	const { secret, ...rest } = hook;
	return { ...rest, signed: Boolean(secret) };
}

export function signBody(secret, body) {
	return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/**
 * POST an event to every subscriber that wants it. Fire-and-forget: a slow
 * or dead endpoint never blocks the scheduler or an API response. Bodies are
 * HMAC-signed in `X-Display-Signature` when the subscriber set a secret.
 */
export function deliverWebhooks(hooks, event, payload, { fetchImpl = fetch, now = Date.now(), log = console } = {}) {
	const targets = hooks.filter((h) => h.events.includes(event));
	const body = JSON.stringify({ event, at: new Date(now).toISOString(), ...payload });
	return Promise.allSettled(
		targets.map(async (h) => {
			const headers = { 'Content-Type': 'application/json', 'X-Display-Event': event };
			if (h.secret) headers['X-Display-Signature'] = signBody(h.secret, body);
			try {
				const res = await fetchImpl(h.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
				if (!res.ok) log.warn?.(`webhook ${h.name || h.url} answered ${res.status} to ${event}`);
				return res.status;
			} catch (err) {
				log.warn?.(`webhook ${h.name || h.url} failed for ${event}: ${err.message}`);
				throw err;
			}
		})
	);
}
