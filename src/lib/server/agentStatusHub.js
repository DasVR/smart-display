/**
 * What the coding agents are doing, from their own hooks and from Cursor's
 * cloud (src/lib/agentHooks.js).
 *
 *   POST /api/agents/hook?agent=claude|cursor[&remote=1]
 *        body: the hook's own JSON, untouched (hooks/wall-status.mjs sends it).
 *        From another machine it needs the wall's API token (Bearer).
 *   GET  /api/agents/sessions   every session the wall knows about
 *
 * With CURSOR_API_KEY set, Cursor's cloud agents are polled every minute.
 * Every change calls onStatus(agent, status, before), and src/ws-server.js
 * puts it on the roster.
 */

import path from 'node:path';
import { agentStatus, applyHook, readHook, sweepSessions, withCursorCloud } from '../agentHooks.js';
import { authorized, loadApiToken } from './taskService.js';

const AGENTS = ['claude', 'cursor'];
const CURSOR_API = 'https://api.cursor.com/v1/agents?limit=20&includeArchived=false';
const MAX_BODY = 256 * 1024;

export function createAgentStatusHub({ dataDir, isLocal = () => false, onStatus = () => {}, env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console.log }) {
	const tokenFile = path.join(dataDir, 'api-token');
	let sessions = {};
	let cloud = { ok: null, at: 0, error: '' };

	function commit(next) {
		if (next === sessions) return;
		const before = Object.fromEntries(AGENTS.map((a) => [a, agentStatus(sessions, a)]));
		sessions = next;
		for (const a of AGENTS) {
			const after = agentStatus(sessions, a);
			const b = before[a];
			if (after.phase !== b.phase || after.task !== b.task || after.body !== b.body || after.busy !== b.busy) onStatus(a, after, b);
		}
	}

	/** One hook's JSON. Returns the step read from it, or null when it says nothing new. */
	function hook(body, opts = {}) {
		const step = readHook(body, opts);
		if (step) commit(applyHook(sessions, step, now()));
		return step;
	}

	function tick() {
		commit(sweepSessions(sessions, now()));
	}

	async function pollCursor() {
		const key = String(env.CURSOR_API_KEY || '').trim();
		if (!key || !fetchImpl) return null;
		try {
			const r = await fetchImpl(CURSOR_API, {
				headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
				signal: AbortSignal.timeout(10000)
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const data = await r.json();
			commit(withCursorCloud(sessions, data?.items || [], now()));
			cloud = { ok: true, at: now(), error: '' };
		} catch (e) {
			if (cloud.ok !== false) log(`agents: Cursor cloud: ${e.message}`);
			cloud = { ok: false, at: now(), error: e.message };
		}
		return cloud;
	}

	function snapshot() {
		return {
			sessions: Object.values(sessions).sort((a, b) => b.at - a.at),
			agents: Object.fromEntries(AGENTS.map((a) => [a, agentStatus(sessions, a)])),
			cursorCloud: env.CURSOR_API_KEY ? cloud : null
		};
	}

	function json(res, data, status = 200) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	}

	function readBody(req) {
		return new Promise((resolve, reject) => {
			let raw = '';
			req.on('data', (c) => {
				raw += c;
				if (raw.length > MAX_BODY) reject(new Error('too large'));
			});
			req.on('end', () => resolve(raw));
			req.on('error', reject);
		});
	}

	async function handleHttp(req, res) {
		const url = new URL(req.url || '/', 'http://local');
		if (url.pathname !== '/api/agents/hook' && url.pathname !== '/api/agents/sessions') return false;
		if (!isLocal(req) && !authorized(req.headers, loadApiToken(tokenFile, env))) return json(res, { error: 'unauthorized' }, 401), true;
		if (req.method === 'GET' && url.pathname === '/api/agents/sessions') return json(res, snapshot()), true;
		if (req.method !== 'POST' || url.pathname !== '/api/agents/hook') return json(res, { error: 'not found' }, 404), true;
		let body;
		try {
			body = JSON.parse((await readBody(req)) || '{}');
		} catch {
			return json(res, { error: 'invalid json' }, 400), true;
		}
		const remote = /^(1|true|yes)$/i.test(url.searchParams.get('remote') || String(req.headers['x-wall-remote'] || ''));
		const step = hook(body, { agent: url.searchParams.get('agent') || '', remote });
		// a hook must never hold the agent up: always a quick, empty-handed 200
		return json(res, { ok: true, read: step ? step.phase : null }), true;
	}

	return { hook, tick, pollCursor, snapshot, handleHttp };
}
