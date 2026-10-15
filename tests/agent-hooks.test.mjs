import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FORGET_MS, STALE_MS, agentOfHook, agentStatus, applyHook, readHook, sweepSessions, toolLine, withCursorCloud } from '../src/lib/agentHooks.js';
import { applyAgentStatus, emptyRoster, leadAgent } from '../src/lib/agentRoster.js';
import { castFor } from '../src/lib/agentStage.js';
import { createAgentStatusHub } from '../src/lib/server/agentStatusHub.js';
import { slim } from '../hooks/wall-status.mjs';

const cc = (event, extra = {}) => ({ hook_event_name: event, session_id: 's1', cwd: '/home/me/smart-display', ...extra });
const run = (steps, t0 = 0) => steps.reduce((s, b, i) => applyHook(s, readHook(b), t0 + i * 1000), {});

test('Claude Code: a prompt, its tools, a question, the finish', () => {
	assert.deepEqual(readHook(cc('UserPromptSubmit', { prompt: 'fix the webcam\nplease' })), {
		agent: 'claude',
		session: 's1',
		phase: 'working',
		task: 'Thinking',
		prompt: 'fix the webcam',
		project: 'smart-display',
		remote: false
	});
	assert.equal(readHook(cc('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } })).task, 'Bash: npm test');
	assert.equal(readHook(cc('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })).phase, 'waiting');
	assert.equal(readHook(cc('Notification', { notification_type: 'idle_prompt' })).phase, 'done');
	assert.equal(readHook(cc('Notification', { notification_type: 'auth_success' })), null);
	assert.equal(readHook(cc('StopFailure', { error: 'rate_limit' })).phase, 'error');
	assert.equal(readHook(cc('SessionStart')), null, 'opening a session is not working yet');
	assert.equal(readHook(null), null);
});

test('Cursor: told apart by its fields, and its stop status counts', () => {
	const c = (event, extra = {}) => ({ hook_event_name: event, conversation_id: 'c1', workspace_roots: ['/w/app'], ...extra });
	assert.equal(agentOfHook(c('stop')), 'cursor');
	assert.equal(agentOfHook({ hook_event_name: 'Stop' }), 'claude');
	assert.equal(agentOfHook({ hook_event_name: 'Stop' }, 'cursor'), 'cursor', 'the hook can say who it is');
	assert.equal(readHook(c('beforeSubmitPrompt', { prompt: 'add tests' })).prompt, 'add tests');
	assert.equal(readHook(c('afterShellExecution', { command: 'pnpm build' })).task, 'Shell: pnpm build');
	assert.equal(readHook(c('afterFileEdit', { file_path: '/w/app/src/a.ts' })).task, 'Edit: a.ts');
	assert.equal(readHook(c('stop', { status: 'completed' })).phase, 'done');
	assert.equal(readHook(c('stop', { status: 'error' })).phase, 'error');
	assert.equal(readHook(c('stop', { status: 'aborted' })).task, 'Stopped');
	assert.equal(readHook(c('beforeSubmitPrompt')).project, 'app');
});

test('a session keeps what you asked while its tools run, and finishes with it', () => {
	const s = run([cc('UserPromptSubmit', { prompt: 'fix the webcam' }), cc('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/x/senses.js' } })]);
	assert.equal(s['claude:s1'].task, 'Edit: senses.js');
	assert.equal(s['claude:s1'].prompt, 'fix the webcam');
	assert.equal(s['claude:s1'].since, 0);
	const done = applyHook(s, readHook(cc('Stop')), 5000);
	assert.equal(done['claude:s1'].phase, 'done');
	assert.equal(done['claude:s1'].task, 'fix the webcam');
	// a new prompt is a new run
	const again = applyHook(done, readHook(cc('UserPromptSubmit', { prompt: 'and the docs' })), 9000);
	assert.equal(again['claude:s1'].since, 9000);
	assert.equal(again['claude:s1'].prompt, 'and the docs');
	assert.deepEqual(applyHook(again, readHook(cc('SessionEnd')), 10000), {});
});

test('the busiest session speaks for the agent: needs you, then working, then finished', () => {
	let s = run([cc('UserPromptSubmit', { prompt: 'one' }), { ...cc('UserPromptSubmit', { prompt: 'two' }), session_id: 's2', cwd: '/w/other' }]);
	let st = agentStatus(s, 'claude');
	assert.equal(st.phase, 'working');
	assert.equal(st.busy, 2);
	assert.match(st.body, /other · “two” · \+1 more/);
	s = applyHook(s, readHook(cc('Notification', { notification_type: 'permission_prompt', message: 'May I run git push?' })), 5000);
	st = agentStatus(s, 'claude');
	assert.equal(st.phase, 'waiting');
	assert.equal(st.task, 'May I run git push?');
	assert.deepEqual(agentStatus(s, 'cursor').phase, 'idle');
});

test('a session that goes quiet without finishing stops counting, and is forgotten later', () => {
	const s = run([cc('UserPromptSubmit', { prompt: 'long job' })]);
	assert.equal(sweepSessions(s, STALE_MS - 1), s);
	const swept = sweepSessions(s, STALE_MS);
	assert.equal(swept['claude:s1'].phase, 'done');
	assert.equal(agentStatus(swept, 'claude').stale, true);
	assert.deepEqual(sweepSessions(run([cc('Stop')]), FORGET_MS), {});
});

test('Cursor cloud agents: ACTIVE is working, IDLE finished, archived and old ones left out', () => {
	const now = Date.parse('2026-10-15T14:00:00Z');
	const items = [
		{ id: 'bc-1', name: 'Fix login', status: 'ACTIVE', updatedAt: '2026-10-15T13:59:00Z' },
		{ id: 'bc-2', name: 'Docs pass', status: 'IDLE', updatedAt: '2026-10-15T13:00:00Z' },
		{ id: 'bc-3', name: 'Old', status: 'IDLE', updatedAt: '2026-10-14T01:00:00Z' },
		{ id: 'bc-4', name: 'Gone', status: 'ARCHIVED', updatedAt: '2026-10-15T13:59:00Z' }
	];
	const local = run([{ hook_event_name: 'stop', conversation_id: 'c1' }]);
	const s = withCursorCloud(local, items, now);
	assert.deepEqual(Object.keys(s).sort(), ['cursor:c1', 'cursor:cloud-bc-1', 'cursor:cloud-bc-2']);
	const st = agentStatus(s, 'cursor');
	assert.equal(st.phase, 'working');
	assert.equal(st.task, 'Fix login');
	assert.equal(st.remote, true);
	assert.match(st.body, /cloud/);
	// the next poll replaces them: bc-1 finished
	const later = withCursorCloud(s, [{ ...items[0], status: 'IDLE' }], now + 60000);
	assert.equal(agentStatus(later, 'cursor').phase, 'done');
	assert.equal(later['cursor:cloud-bc-2'], undefined);
});

test('the roster card, the lead and the stage follow a waiting agent', () => {
	let roster = applyAgentStatus(emptyRoster(), 'cursor', { phase: 'working', task: 'Shell: pnpm build', body: 'app', busy: 1, at: 1 });
	roster = applyAgentStatus(roster, 'claude', { phase: 'waiting', task: 'May I push?', body: 'smart-display · cloud', busy: 1, remote: true, at: 2 });
	assert.equal(leadAgent(roster).id, 'claude');
	assert.deepEqual(castFor({ roster }).map((c) => [c.character, c.target, c.approval]), [
		['claude', 'ask', null],
		['cursor', 'work', null]
	]);
	// going idle after a run reads as finished, not as never having run
	assert.equal(applyAgentStatus(roster, 'cursor', { phase: 'idle', at: 3 }).find((a) => a.id === 'cursor').phase, 'done');
	assert.equal(toolLine('', {}), '');
});

test('the hook script sends only what the wall reads', () => {
	const out = slim({
		hook_event_name: 'PostToolUse',
		session_id: 's',
		tool_name: 'Read',
		tool_input: { file_path: '/a/b.js', content: 'SECRET' },
		tool_response: { output: 'SECRET' },
		transcript_path: '/home/me/.claude/x.jsonl',
		prompt: 'my prompt'
	}, { sendPrompt: false });
	assert.deepEqual(out, { hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Read', tool_input: { file_path: '/a/b.js' } });
});

test('hub: hooks over HTTP, the token from elsewhere, and a status call on each change', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'agents-'));
	writeFileSync(path.join(dataDir, 'api-token'), 'tok\n');
	let local = true;
	const calls = [];
	const hub = createAgentStatusHub({ dataDir, isLocal: () => local, onStatus: (a, st, before) => calls.push([a, before.phase, st.phase]), log() {} });
	const server = createServer(async (req, res) => {
		if (!(await hub.handleHttp(req, res))) res.writeHead(404).end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const url = `http://127.0.0.1:${server.address().port}`;
	const post = (body, q = '', headers = {}) => fetch(`${url}/api/agents/hook${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
	try {
		assert.equal((await (await post(cc('UserPromptSubmit', { prompt: 'go' }), '?remote=1')).json()).read, 'working');
		await post(cc('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
		await post(cc('Stop'));
		assert.deepEqual(calls.map((c) => c.slice(1)), [['idle', 'working'], ['working', 'working'], ['working', 'done']]);
		assert.equal(hub.snapshot().sessions[0].remote, true);
		assert.equal((await (await post({ hook_event_name: 'SessionStart' })).json()).read, null);
		assert.equal((await fetch(`${url}/api/agents/hook`, { method: 'POST', body: 'nope' })).status, 400);
		local = false;
		assert.equal((await post(cc('Stop'))).status, 401);
		assert.equal((await post(cc('Stop'), '', { Authorization: 'Bearer tok' })).status, 200);
		assert.equal((await fetch(`${url}/api/agents/sessions`, { headers: { Authorization: 'Bearer tok' } })).status, 200);
	} finally {
		server.close();
	}
});

test('hub: Cursor cloud polling, with the key as Basic auth', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'agents-'));
	const seen = [];
	const fetchImpl = async (u, o) => {
		seen.push([u, o.headers.Authorization]);
		return { ok: true, json: async () => ({ items: [{ id: 'bc-9', name: 'Refactor', status: 'ACTIVE', updatedAt: new Date().toISOString() }] }) };
	};
	const calls = [];
	const hub = createAgentStatusHub({ dataDir, env: { CURSOR_API_KEY: 'key' }, fetchImpl, onStatus: (a, st) => calls.push([a, st.phase, st.task]), log() {} });
	assert.equal((await hub.pollCursor()).ok, true);
	assert.match(seen[0][0], /^https:\/\/api\.cursor\.com\/v1\/agents/);
	assert.equal(seen[0][1], `Basic ${Buffer.from('key:').toString('base64')}`);
	assert.deepEqual(calls, [['cursor', 'working', 'Refactor']]);
	const off = createAgentStatusHub({ dataDir, env: {}, fetchImpl, log() {} });
	assert.equal(await off.pollCursor(), null);
	// or the key saved on the wall
	writeFileSync(path.join(dataDir, 'cursor-api-key'), 'filekey\n');
	assert.equal((await off.pollCursor()).ok, true);
	assert.equal(seen.at(-1)[1], `Basic ${Buffer.from('filekey:').toString('base64')}`);
});
