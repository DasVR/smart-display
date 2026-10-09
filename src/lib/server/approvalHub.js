/**
 * Agent approvals over HTTP and WebSocket (model: src/lib/approvals.js).
 *
 * HTTP (JSON; same Bearer token as /api/tasks once one is configured):
 *   POST   /api/approvals             { source, title?, tool?, detail?, cwd?, timeout? }
 *                                     add ?wait=1 to hold the request open until
 *                                     someone decides or it times out
 *   GET    /api/approvals             pending requests
 *   GET    /api/approvals/:id         one request (?wait=1 to long-poll for the decision)
 *   POST   /api/approvals/:id         { decision: 'allow' | 'deny' }
 *   DELETE /api/approvals/:id         withdraw it (answered in the terminal instead)
 *
 * WebSocket (/ws): { type: 'approvals', op: 'decide', id, decision } and every
 * change is broadcast as { type: 'approvals', approvals: [...] }.
 *
 * Kept in memory only: a request outlives its agent's wait by seconds, so
 * there's nothing worth saving across a restart.
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { decideApproval, expireApprovals, normalizeApproval, pendingApprovals, pruneApprovals } from '../approvals.js';
import { authorized, loadApiToken } from './taskService.js';

const MAX_BODY = 16 * 1024;

function readJson(req) {
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (c) => {
			raw += c;
			if (raw.length > MAX_BODY) {
				reject(Object.assign(new Error('body too large'), { status: 413 }));
				req.destroy();
			}
		});
		req.on('end', () => {
			if (!raw.trim()) return resolve({});
			try {
				resolve(JSON.parse(raw));
			} catch {
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

export function createApprovalHub({ dataDir, broadcast, log = console, now = () => Date.now(), env = process.env, onDecide }) {
	const tokenFile = path.join(dataDir, 'api-token');
	let list = [];
	/** id -> Set of callbacks waiting on a decision */
	const waiters = new Map();
	const timers = new Map();

	function snapshot() {
		return pendingApprovals(list, now());
	}
	function changed() {
		broadcast({ type: 'approvals', approvals: snapshot() });
	}
	function settle(a) {
		clearTimeout(timers.get(a.id));
		timers.delete(a.id);
		for (const cb of waiters.get(a.id) ?? []) cb(a);
		waiters.delete(a.id);
	}
	function sweep() {
		const r = expireApprovals(list, now());
		list = pruneApprovals(r.list, now());
		for (const a of r.expired) settle(a);
		if (r.expired.length) changed();
	}

	function request(input) {
		sweep();
		const { approval, error } = normalizeApproval(input, { now: now(), id: randomBytes(5).toString('hex') });
		if (error) return { error, status: 400 };
		list = [...list, approval];
		const ms = Date.parse(approval.expiresAt) - now();
		timers.set(approval.id, setTimeout(sweep, ms + 50));
		changed();
		broadcast({
			type: 'notify',
			title: `${approval.source} needs you`,
			body: approval.title,
			severity: 'warn',
			source: approval.source,
			kind: 'approval',
			ttl: 12000
		});
		return { approval };
	}
	function decide(id, decision, by) {
		sweep();
		const i = list.findIndex((a) => a.id === id);
		const r = decideApproval(list[i], decision, { by, now: now() });
		if (r.error) return r;
		list = list.map((a, j) => (j === i ? r.approval : a));
		settle(r.approval);
		onDecide?.(r.approval);
		changed();
		return r;
	}
	function withdraw(id) {
		const a = list.find((x) => x.id === id);
		if (!a) return { error: 'not found', status: 404 };
		if (a.status !== 'pending') return { approval: a };
		const done = { ...a, status: 'withdrawn', decidedAt: new Date(now()).toISOString() };
		list = list.map((x) => (x.id === id ? done : x));
		settle(done);
		changed();
		return { approval: done };
	}
	/** Resolve once the request is settled (or immediately, if it already is). */
	function waitFor(id) {
		const a = list.find((x) => x.id === id);
		if (!a || a.status !== 'pending') return Promise.resolve(a ?? null);
		return new Promise((resolve) => {
			if (!waiters.has(id)) waiters.set(id, new Set());
			waiters.get(id).add(resolve);
		});
	}

	function handleWs(msg) {
		if (msg?.type !== 'approvals') return null;
		if (msg.op === 'decide') return decide(msg.id, msg.decision, msg.by || 'display');
		return null;
	}

	function send(res, status, data) {
		if (res.writableEnded) return;
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	}
	function answer(a) {
		return { id: a.id, status: a.status, decision: a.status === 'allow' || a.status === 'deny' ? a.status : null, decidedBy: a.decidedBy, approval: a };
	}

	async function handleHttp(req, res) {
		const url = new URL(req.url, 'http://local');
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts[0] !== 'api' || parts[1] !== 'approvals') return false;
		if (!authorized(req.headers, loadApiToken(tokenFile, env))) {
			send(res, 401, { error: 'missing or wrong bearer token' });
			return true;
		}
		const id = parts[2];
		const wait = url.searchParams.has('wait') && url.searchParams.get('wait') !== '0';
		try {
			if (!id && req.method === 'GET') return send(res, 200, { approvals: snapshot() }), true;
			if (!id && req.method === 'POST') {
				const r = request(await readJson(req));
				if (r.error) return send(res, r.status, { error: r.error }), true;
				if (!wait) return send(res, 201, answer(r.approval)), true;
				await holdOpen(req, res, r.approval.id, true);
				return true;
			}
			if (!id) return send(res, 405, { error: 'method not allowed' }), true;

			if (req.method === 'GET') {
				const a = list.find((x) => x.id === id);
				if (!a) return send(res, 404, { error: 'not found' }), true;
				if (!wait || a.status !== 'pending') return send(res, 200, answer(a)), true;
				await holdOpen(req, res, id, false);
				return true;
			}
			if (req.method === 'POST') {
				const body = await readJson(req);
				const r = decide(id, body.decision, body.by || 'api');
				return (r.error ? send(res, r.status, { error: r.error }) : send(res, 200, answer(r.approval))), true;
			}
			if (req.method === 'DELETE') {
				const r = withdraw(id);
				return (r.error ? send(res, r.status, { error: r.error }) : send(res, 200, answer(r.approval))), true;
			}
			return send(res, 405, { error: 'method not allowed' }), true;
		} catch (err) {
			send(res, err.status || 500, { error: err.status ? err.message : 'server error' });
			if (!err.status) log.error?.(`approvals: ${err.stack || err.message}`);
			return true;
		}
	}

	/** Long-poll: answer when decided. If the agent hangs up first, withdraw it so the card goes away. */
	async function holdOpen(req, res, id, created) {
		let gone = false;
		const onClose = () => {
			if (res.writableEnded) return;
			gone = true;
			if (created) withdraw(id);
		};
		res.on('close', onClose);
		const a = await waitFor(id);
		res.off('close', onClose);
		if (!gone && a) send(res, created ? 201 : 200, answer(a));
	}

	function stop() {
		for (const t of timers.values()) clearTimeout(t);
		timers.clear();
	}

	return { handleHttp, handleWs, snapshot, request, decide, withdraw, waitFor, stop };
}
