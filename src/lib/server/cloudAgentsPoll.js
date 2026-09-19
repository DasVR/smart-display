import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT } from './displayPower.js';
import { snapshotFromPayloads } from '../cloudAgents.js';

const EMPTY = snapshotFromPayloads({});
const TTL_MS = 8_000;
const FETCH_MS = 4_000;

let cache = { at: 0, snapshot: EMPTY };

function trimSecret(value) {
	return String(value || '').trim();
}

function parseSecretFile(filePath) {
	if (!filePath || !existsSync(filePath)) return '';
	try {
		const raw = readFileSync(filePath, 'utf8').trim();
		if (!raw) return '';
		if (raw.startsWith('{')) {
			const json = JSON.parse(raw);
			return trimSecret(json.apiKey || json.token || json.key || json.CURSOR_API_KEY || json.ANTHROPIC_API_KEY);
		}
		return raw.split(/\r?\n/)[0].trim();
	} catch {
		return '';
	}
}

function firstSecret(paths) {
	for (const filePath of paths) {
		if (!filePath) continue;
		const value = parseSecretFile(filePath);
		if (value) return value;
	}
	return '';
}

export function cursorApiKey(env = process.env) {
	const fromEnv = trimSecret(env.CURSOR_API_KEY);
	if (fromEnv) return fromEnv;
	return firstSecret([
		trimSecret(env.CURSOR_API_KEY_PATH),
		path.join(PROJECT_ROOT, '.cursor_api_key'),
		path.join(os.homedir(), '.cursor', 'api_key')
	]);
}

export function anthropicApiKey(env = process.env) {
	const fromEnv = trimSecret(env.ANTHROPIC_API_KEY);
	if (fromEnv) return fromEnv;
	return firstSecret([
		trimSecret(env.ANTHROPIC_API_KEY_PATH),
		path.join(PROJECT_ROOT, '.anthropic_api_key')
	]);
}

export function cloudSnapshotPath(env = process.env) {
	if (env.CLOUD_AGENTS_SNAPSHOT) return env.CLOUD_AGENTS_SNAPSHOT;
	if (env.NODE_ENV === 'production') return '';
	const local = path.join(PROJECT_ROOT, 'data/cloud-agents.json');
	return existsSync(local) ? local : '';
}

function readSnapshotFile(filePath) {
	if (!filePath || !existsSync(filePath)) return null;
	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return null;
	}
}

async function fetchJson(url, headers) {
	const r = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(FETCH_MS)
	});
	if (!r.ok) throw new Error(`${r.status}`);
	return r.json();
}

export async function fetchCursorCloudPayload(key, fetchImpl = fetchJson) {
	if (!key) return null;
	const auth = {
		Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`
	};
	try {
		return await fetchImpl('https://api.cursor.com/v1/agents?limit=50&includeArchived=false', auth);
	} catch {
		try {
			return await fetchImpl('https://api.cursor.com/v0/agents?limit=50', auth);
		} catch {
			return null;
		}
	}
}

export async function fetchClaudeCloudPayload(key, fetchImpl = fetchJson) {
	if (!key) return null;
	try {
		return await fetchImpl('https://api.anthropic.com/v1/sessions?statuses=running', {
			'x-api-key': key,
			'anthropic-version': '2023-06-01',
			'anthropic-beta': 'managed-agents-2026-04-01'
		});
	} catch {
		return null;
	}
}

export async function loadCloudSnapshot({
	env = process.env,
	fetchImpl = fetchJson,
	now = Date.now()
} = {}) {
	const filePayload = readSnapshotFile(cloudSnapshotPath(env));
	const cursorKey = cursorApiKey(env);
	const claudeKey = anthropicApiKey(env);
	const cursorPayload = cursorKey
		? (await fetchCursorCloudPayload(cursorKey, fetchImpl)) || filePayload
		: filePayload;
	const claudePayload = claudeKey
		? (await fetchClaudeCloudPayload(claudeKey, fetchImpl)) ||
			filePayload?.claude ||
			filePayload?.sessions
		: filePayload?.claude || filePayload?.sessions || null;
	if (!cursorPayload && !claudePayload && filePayload) {
		return snapshotFromPayloads({
			cursor: filePayload.cursor || filePayload,
			claude: filePayload.claude
		});
	}
	return snapshotFromPayloads({
		cursor: cursorPayload || filePayload,
		claude: claudePayload
	});
}

export async function refreshCloudSnapshot(opts = {}) {
	const now = opts.now ?? Date.now();
	if (!opts.force && cache.at && now - cache.at < TTL_MS) return cache.snapshot;
	const snapshot = await loadCloudSnapshot(opts);
	cache = { at: now, snapshot };
	return snapshot;
}

export function resetCloudSnapshotCache() {
	cache = { at: 0, snapshot: EMPTY };
}
