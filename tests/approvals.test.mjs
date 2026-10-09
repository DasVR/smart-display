import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideApproval, expireApprovals, normalizeApproval, pendingApprovals } from '../src/lib/approvals.js';
import { createApprovalHub } from '../src/lib/server/approvalHub.js';
import { describe as describeInput, hookOutput, verb } from '../hooks/display-approve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, warn() {}, error() {} };
const NOW = 1_800_000_000_000;

test('the model: validate, decide once, expire', () => {
	assert.match(normalizeApproval({}, { now: NOW, id: 'a' }).error, /title or tool/);
	const { approval } = normalizeApproval({ source: 'Claude Code', tool: 'Bash', detail: 'npm test', timeout: 5 }, { now: NOW, id: 'a' });
	assert.equal(approval.title, 'Run Bash?');
	assert.equal(Date.parse(approval.expiresAt) - NOW, 15000, 'timeout clamped up to 15 s');

	const allowed = decideApproval(approval, 'allow', { by: 'kiosk', now: NOW + 1000 }).approval;
	assert.equal(allowed.status, 'allow');
	assert.equal(decideApproval(allowed, 'deny', { now: NOW + 2000 }).status, 409, 'first answer wins');
	assert.equal(decideApproval(approval, 'maybe', { now: NOW }).status, 400);
	assert.equal(decideApproval(approval, 'allow', { now: NOW + 16000 }).error, 'expired');

	const { list, expired } = expireApprovals([approval], NOW + 16000);
	assert.equal(expired.length, 1);
	assert.equal(list[0].status, 'timeout');
	assert.deepEqual(pendingApprovals(list, NOW + 16000), []);
});

async function harness({ token } = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'appr-'));
	if (token) writeFileSync(path.join(dataDir, 'api-token'), token);
	const sent = [];
	const hub = createApprovalHub({ dataDir, broadcast: (m) => sent.push(m), log: quiet, env: {} });
	const server = createServer(async (req, res) => {
		if (!(await hub.handleHttp(req, res))) (res.writeHead(404), res.end());
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	return {
		hub,
		sent,
		base,
		close: () => {
			hub.stop();
			server.closeAllConnections?.();
			return new Promise((r) => server.close(r));
		}
	};
}

const until = async (fn) => {
	for (let i = 0; i < 200; i++) {
		const v = fn();
		if (v) return v;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error('timed out waiting');
};

test('long-poll: the request waits for a tap on the wall', async () => {
	const h = await harness();
	try {
		const pending = fetch(`${h.base}/api/approvals?wait=1`, {
			method: 'POST',
			body: JSON.stringify({ source: 'Claude Code', tool: 'Bash', detail: 'rm -rf build' })
		}).then((r) => r.json());
		const card = await until(() => h.hub.snapshot()[0]);
		assert.equal(card.detail, 'rm -rf build');
		assert.ok(h.sent.some((m) => m.type === 'notify' && m.kind === 'approval'), 'the island speaks up');

		// the kiosk answers over the socket
		assert.equal(h.hub.handleWs({ type: 'approvals', op: 'decide', id: card.id, decision: 'deny' }).approval.status, 'deny');
		const answer = await pending;
		assert.equal(answer.decision, 'deny');
		assert.deepEqual(h.hub.snapshot(), []);
		assert.deepEqual(h.sent.at(-1), { type: 'approvals', approvals: [] });
	} finally {
		await h.close();
	}
});

test('without wait, poll by id; withdraw clears the card; token guards it', async () => {
	const h = await harness({ token: 't0k' });
	try {
		assert.equal((await fetch(`${h.base}/api/approvals`)).status, 401);
		const auth = { Authorization: 'Bearer t0k' };
		const created = await (await fetch(`${h.base}/api/approvals`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Deploy?' }) })).json();
		assert.equal(created.status, 'pending');
		const poll = fetch(`${h.base}/api/approvals/${created.id}?wait=1`, { headers: auth }).then((r) => r.json());
		await new Promise((r) => setTimeout(r, 30));
		const decided = await (
			await fetch(`${h.base}/api/approvals/${created.id}`, { method: 'POST', headers: auth, body: JSON.stringify({ decision: 'allow', by: 'phone' }) })
		).json();
		assert.equal(decided.decidedBy, 'phone');
		assert.equal((await poll).decision, 'allow');

		const again = await (await fetch(`${h.base}/api/approvals`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Push?' }) })).json();
		const gone = await (await fetch(`${h.base}/api/approvals/${again.id}`, { method: 'DELETE', headers: auth })).json();
		assert.equal(gone.status, 'withdrawn');
		assert.deepEqual(h.hub.snapshot(), []);
	} finally {
		await h.close();
	}
});

test('an agent that hangs up takes its card with it', async () => {
	const h = await harness();
	try {
		const ac = new AbortController();
		fetch(`${h.base}/api/approvals?wait=1`, { method: 'POST', body: JSON.stringify({ title: 'Hi?' }), signal: ac.signal }).catch(() => {});
		await until(() => h.hub.snapshot().length);
		ac.abort();
		await until(() => !h.hub.snapshot().length);
	} finally {
		await h.close();
	}
});

test('the Claude Code hook: describes the tool, prints the decision, stays silent otherwise', async () => {
	assert.equal(verb('Bash'), 'Run a command');
	assert.equal(verb('mcp__github__create_pull_request'), 'Use github create_pull_request');
	assert.equal(describeInput('Bash', { command: 'npm test' }), 'npm test');
	assert.equal(describeInput('Edit', { file_path: '/a/b.js', old_string: 'x' }), '/a/b.js');
	assert.deepEqual(hookOutput('PermissionRequest', 'allow'), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
	assert.equal(hookOutput('PreToolUse', 'deny').hookSpecificOutput.permissionDecision, 'deny');

	const h = await harness();
	const run = (env) =>
		new Promise((resolve) => {
			const child = spawn(process.execPath, [path.join(root, 'hooks/display-approve.mjs')], { env: { ...process.env, ...env } });
			let out = '';
			child.stdout.on('data', (d) => (out += d));
			child.on('close', (code) => resolve({ code, out }));
			child.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: '/home/me/proj' }));
		});
	try {
		const result = run({ DISPLAY_HOST: h.base });
		const card = await until(() => h.hub.snapshot()[0]);
		assert.equal(card.title, 'Run a command?');
		assert.equal(card.detail, 'git push');
		assert.equal(card.cwd, 'me/proj');
		h.hub.decide(card.id, 'allow', 'kiosk');
		const { code, out } = await result;
		assert.equal(code, 0);
		assert.deepEqual(JSON.parse(out), hookOutput('PermissionRequest', 'allow'));

		const offline = await run({ DISPLAY_HOST: 'http://127.0.0.1:9' });
		assert.deepEqual(offline, { code: 0, out: '' }, 'unreachable display: say nothing, the terminal asks');
	} finally {
		await h.close();
	}
});
