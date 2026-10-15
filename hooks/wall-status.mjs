#!/usr/bin/env node
// Tell the wall what a coding agent is doing, from its own hooks.
//
// Claude Code and Cursor run this at each step of a session and hand it the
// step as JSON on stdin. It sends the few fields the wall reads (never tool
// output, file contents or transcripts) to POST /api/agents/hook and exits 0
// straight away, whatever happens: the agent is never held up or blocked.
//
//   node hooks/wall-status.mjs [claude|cursor]
//
// WALL_URL       the wall, e.g. http://wall.local:3000 or your tunnel's https URL
//                (DISPLAY_HOST works too). Unset: does nothing.
// WALL_TOKEN     the wall's API token (DISPLAY_API_TOKEN works too); needed
//                from anywhere but the wall itself
// WALL_SEND_PROMPT=0   keep what you typed off the wall (only "Thinking" shows)
// WALL_REMOTE=1  mark the session as cloud (Claude Code on the web sets
//                CLAUDE_CODE_REMOTE itself)
//
// Without those, it reads ~/.config/smart-display/wall-status.json
// ({ "url", "token", "sendPrompt" }), which scripts/setup-agent-status.mjs
// writes; the environment wins where both are set.
//
// docs/agent-status.md has the settings for each tool.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** The saved settings, or {} (none, unreadable, not JSON). */
export function savedConfig(env = process.env) {
	const dir = env.XDG_CONFIG_HOME || path.join(env.HOME || homedir(), '.config');
	try {
		const c = JSON.parse(readFileSync(path.join(dir, 'smart-display', 'wall-status.json'), 'utf8'));
		return c && typeof c === 'object' ? c : {};
	} catch {
		return {};
	}
}

const saved = savedConfig();
const base = String(process.env.WALL_URL || process.env.DISPLAY_HOST || saved.url || '').replace(/\/+$/, '');
const token = String(process.env.WALL_TOKEN || process.env.DISPLAY_API_TOKEN || saved.token || '').trim();
const sendPrompt = process.env.WALL_SEND_PROMPT ? process.env.WALL_SEND_PROMPT !== '0' : saved.sendPrompt !== false;
const agent = /^(claude|cursor)$/.test(process.argv[2] || '') ? process.argv[2] : '';
const remote = process.env.CLAUDE_CODE_REMOTE === 'true' || /^(1|true)$/i.test(process.env.WALL_REMOTE || '');

const clip = (v, n = 200) => (v == null ? undefined : String(v).slice(0, n));

/** Only what src/lib/agentHooks.js reads. */
export function slim(body, { sendPrompt = true } = {}) {
	const i = body?.tool_input && typeof body.tool_input === 'object' ? body.tool_input : {};
	const out = {
		hook_event_name: clip(body?.hook_event_name, 60),
		session_id: clip(body?.session_id, 80),
		conversation_id: clip(body?.conversation_id, 80),
		cwd: clip(body?.cwd, 300),
		workspace_roots: Array.isArray(body?.workspace_roots) ? body.workspace_roots.slice(0, 1).map((r) => clip(r, 300)) : undefined,
		prompt: sendPrompt ? clip(body?.prompt, 200) : undefined,
		tool_name: clip(body?.tool_name, 60),
		tool_input: body?.tool_input
			? { command: clip(i.command), file_path: clip(i.file_path, 300), path: clip(i.path, 300), pattern: clip(i.pattern, 100), description: clip(i.description, 100), url: clip(i.url, 200) }
			: undefined,
		notification_type: clip(body?.notification_type, 60),
		message: clip(body?.message),
		status: clip(body?.status, 20),
		error: clip(body?.error),
		agent_type: clip(body?.agent_type, 60),
		command: clip(body?.command),
		file_path: clip(body?.file_path, 300)
	};
	return JSON.parse(JSON.stringify(out));
}

async function main() {
	let raw = '';
	for await (const chunk of process.stdin) raw += chunk;
	let body = {};
	try {
		body = JSON.parse(raw || '{}');
	} catch {
		return;
	}
	// Cursor waits on beforeSubmitPrompt's answer: always let the prompt through
	if (body.hook_event_name === 'beforeSubmitPrompt') process.stdout.write('{"continue":true}\n');
	if (!base) return;
	const q = new URLSearchParams();
	if (agent) q.set('agent', agent);
	if (remote) q.set('remote', '1');
	await fetch(`${base}/api/agents/hook?${q}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify(slim(body, { sendPrompt })),
		signal: AbortSignal.timeout(3000)
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main()
		.catch(() => {})
		.finally(() => process.exit(0));
}
