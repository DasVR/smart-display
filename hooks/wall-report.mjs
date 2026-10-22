#!/usr/bin/env node
// An agent tells the wall what it's doing, in its own words: a headline for
// the whole job, the step it's on, how far along, and a link (the pull
// request). The hooks (hooks/wall-status.mjs) already say *that* it's
// working; this says *what*. The Agents view shows the headline big and the
// step under it.
//
// As a tool the agent calls (an MCP server, for Claude Code and Cursor):
//   node hooks/wall-report.mjs --mcp          → tool `report_progress`
// From a shell:
//   node hooks/wall-report.mjs "Fix the flaky weather test" --step "Reproducing it" --done 1 --total 4
//   node hooks/wall-report.mjs --phase done --link https://github.com/…/pull/9
//
// Which session: WALL_SESSION_ID, else the latest one the hooks saw in this
// folder (hooks/wall-status.mjs notes it). WALL_URL / WALL_TOKEN as for the
// hooks, or ~/.config/smart-display/wall-status.json. With no wall set up it
// does nothing and says so; it never fails the agent's work.
//
// docs/agent-status.md

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

function savedConfig(env = process.env) {
	const dir = env.XDG_CONFIG_HOME || path.join(env.HOME || homedir(), '.config');
	try {
		const c = JSON.parse(readFileSync(path.join(dir, 'smart-display', 'wall-status.json'), 'utf8'));
		return c && typeof c === 'object' ? c : {};
	} catch {
		return {};
	}
}

const RECENT_MS = 6 * 3600000;

/** The latest session the hooks saw in `cwd`, as { session_id, agent }; else the
 *  most recent one anywhere on this machine (a cloud container runs one); else {}. */
export function latestSession(cwd = process.cwd(), dir = path.join(tmpdir(), 'wall-status'), now = Date.now()) {
	const read = (file) => {
		try {
			return JSON.parse(readFileSync(file, 'utf8')) || {};
		} catch {
			return {};
		}
	};
	const here = read(path.join(dir, `${createHash('sha1').update(String(cwd)).digest('hex').slice(0, 16)}.json`));
	if (here.session_id) return here;
	try {
		const newest = readdirSync(dir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs }))
			.filter((x) => now - x.t < RECENT_MS)
			.sort((a, b) => b.t - a.t)[0];
		return newest ? read(path.join(dir, newest.f)) : {};
	} catch {
		return {};
	}
}

/** The step's JSON for POST /api/agents/hook (src/lib/agentHooks.js reads `WallReport`). */
export function reportBody(r = {}, { session = '', agent = '' } = {}) {
	const body = { hook_event_name: 'WallReport', session_id: String(session || 'default').slice(0, 80) };
	if (agent) body.agent = agent;
	for (const k of ['summary', 'step', 'link', 'phase']) if (r[k] != null && String(r[k]).trim()) body[k] = String(r[k]).trim().slice(0, k === 'link' ? 300 : 120);
	for (const k of ['done', 'total']) if (Number.isFinite(Number(r[k])) && r[k] !== '' && r[k] != null) body[k] = Number(r[k]);
	return body;
}

/** Send one report. Resolves a short sentence saying what happened (never rejects). */
export async function send(r, { env = process.env, cwd = process.cwd(), fetchImpl = globalThis.fetch } = {}) {
	const saved = savedConfig(env);
	const base = String(env.WALL_URL || env.DISPLAY_HOST || saved.url || '').replace(/\/+$/, '');
	const token = String(env.WALL_TOKEN || env.DISPLAY_API_TOKEN || saved.token || '').trim();
	if (!base) return 'No wall set up (WALL_URL), so nothing was sent.';
	const seen = latestSession(cwd);
	const session = env.WALL_SESSION_ID || env.CLAUDE_SESSION_ID || seen.session_id || '';
	const agent = /^(claude|cursor)$/.test(env.WALL_AGENT || '') ? env.WALL_AGENT : seen.agent || '';
	const remote = env.CLAUDE_CODE_REMOTE === 'true' || /^(1|true)$/i.test(env.WALL_REMOTE || '');
	const q = new URLSearchParams();
	if (agent) q.set('agent', agent);
	if (remote) q.set('remote', '1');
	try {
		const res = await fetchImpl(`${base}/api/agents/hook?${q}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify(reportBody(r, { session, agent })),
			signal: AbortSignal.timeout(4000)
		});
		if (res.status === 401) return 'The wall refused the report (set WALL_TOKEN).';
		if (!res.ok) return `The wall answered ${res.status}.`;
		return 'Shown on the wall.';
	} catch {
		return 'The wall did not answer; carry on.';
	}
}

/* ---------- as an MCP tool ---------- */

export const TOOL = {
	name: 'report_progress',
	description:
		"Show what you're doing on the user's wall display, where they glance at it from across the room. Call it when you start a task (summary), at each milestone (step, done/total), when you're blocked on the user (phase: waiting), and when you finish (phase: done, link to the pull request). Keep it short and plain: no file paths in the summary.",
	inputSchema: {
		type: 'object',
		properties: {
			summary: { type: 'string', description: 'The whole job in a few plain words, like "Fix the flaky weather test". Stays up until the next summary.' },
			step: { type: 'string', description: 'What you are doing right now, like "Reproducing the failure".' },
			done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
			total: { type: 'integer', minimum: 1, description: 'Steps in all.' },
			phase: { type: 'string', enum: ['working', 'waiting', 'done', 'error'], description: 'waiting when you need the user, done when finished, error when stopped. Default working.' },
			link: { type: 'string', description: 'An https link worth opening, usually the pull request.' }
		}
	}
};

export async function serveMcp({ input = process.stdin, output = process.stdout, sender = send } = {}) {
	const reply = (id, result) => output.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
	const fail = (id, code, message) => output.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
	const rl = createInterface({ input });
	for await (const line of rl) {
		if (!line.trim()) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			continue;
		}
		const { id, method, params } = msg;
		if (method === 'initialize') reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'wall-report', version: '1.0.0' } });
		else if (method === 'tools/list') reply(id, { tools: [TOOL] });
		else if (method === 'tools/call') {
			if (params?.name !== TOOL.name) fail(id, -32602, `Unknown tool ${params?.name}`);
			else reply(id, { content: [{ type: 'text', text: await sender(params.arguments || {}) }] });
		} else if (method === 'ping') reply(id, {});
		else if (id !== undefined) fail(id, -32601, `No method ${method}`);
	}
}

/* ---------- from a shell ---------- */

export function parseArgs(argv) {
	const r = {};
	const words = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const m = /^--(step|done|total|phase|link|summary)(?:=(.*))?$/.exec(a);
		if (m) r[m[1]] = m[2] ?? argv[++i];
		else if (!a.startsWith('--')) words.push(a);
	}
	if (words.length && !r.summary) r.summary = words.join(' ');
	return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const argv = process.argv.slice(2);
	if (argv.includes('--mcp')) serveMcp();
	else
		send(parseArgs(argv))
			.then((said) => console.log(said))
			.finally(() => process.exit(0));
}
