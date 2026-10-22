import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { TOOL, latestSession, parseArgs, reportBody, send, serveMcp } from '../hooks/wall-report.mjs';
import { readHook } from '../src/lib/agentHooks.js';

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('a report is a WallReport step the wall reads', () => {
	const body = reportBody({ summary: '  Fix the flaky test ', step: 'Reproducing it', done: '1', total: 4, link: 'https://x.y/pull/1' }, { session: 's1', agent: 'cursor' });
	assert.deepEqual(body, { hook_event_name: 'WallReport', session_id: 's1', agent: 'cursor', summary: 'Fix the flaky test', step: 'Reproducing it', link: 'https://x.y/pull/1', done: 1, total: 4 });
	const step = readHook(body);
	assert.deepEqual([step.agent, step.session, step.title, step.progress], ['cursor', 's1', 'Fix the flaky test', { done: 1, total: 4 }]);
});

test('the shell form', () => {
	assert.deepEqual(parseArgs(['Fix', 'the', 'test', '--step', 'Writing it', '--done=2', '--total', '5']), { summary: 'Fix the test', step: 'Writing it', done: '2', total: '5' });
	assert.deepEqual(parseArgs(['--phase', 'done', '--link', 'https://x']), { phase: 'done', link: 'https://x' });
});

test('which session: this folder’s, else the newest, else none', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'notes-'));
	assert.deepEqual(latestSession('/a', dir), {});
	writeFileSync(path.join(dir, 'other.json'), JSON.stringify({ session_id: 'newest', agent: 'claude' }));
	assert.equal(latestSession('/a', dir).session_id, 'newest');
});

test('send posts to the wall, and never throws', async () => {
	const calls = [];
	const fetchImpl = async (url, init) => (calls.push({ url, init }), { ok: true, status: 200 });
	const env = { WALL_URL: 'http://wall:3000/', WALL_TOKEN: 't', WALL_SESSION_ID: 'sess', WALL_AGENT: 'claude', HOME: mkdtempSync(path.join(tmpdir(), 'h-')) };
	assert.equal(await send({ summary: 'Hi' }, { env, fetchImpl }), 'Shown on the wall.');
	assert.equal(calls[0].url, 'http://wall:3000/api/agents/hook?agent=claude');
	assert.equal(calls[0].init.headers.Authorization, 'Bearer t');
	assert.equal(JSON.parse(calls[0].init.body).session_id, 'sess');
	assert.match(await send({ summary: 'Hi' }, { env: { HOME: env.HOME }, fetchImpl }), /No wall/);
	assert.match(await send({ summary: 'Hi' }, { env, fetchImpl: async () => { throw new Error('down'); } }), /did not answer/);
	assert.match(await send({ summary: 'Hi' }, { env, fetchImpl: async () => ({ ok: false, status: 401 }) }), /WALL_TOKEN/);
});

test('as an MCP server: one tool, report_progress', async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	let out = '';
	output.on('data', (c) => (out += c));
	const sent = [];
	const done = serveMcp({ input, output, sender: async (a) => (sent.push(a), 'Shown on the wall.') });
	input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n');
	input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
	input.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"report_progress","arguments":{"summary":"Ship it","phase":"done"}}}\n');
	input.end();
	await done;
	const replies = out.trim().split('\n').map((l) => JSON.parse(l));
	assert.equal(replies[1].result.tools[0].name, TOOL.name);
	assert.equal(replies[2].result.content[0].text, 'Shown on the wall.');
	assert.deepEqual(sent, [{ summary: 'Ship it', phase: 'done' }]);
});

test('the plugin carries the same scripts and skill as the repo', () => {
	for (const f of ['wall-status.mjs', 'wall-report.mjs']) assert.equal(readFileSync(path.join(here, 'plugins/wall-status/scripts', f), 'utf8'), readFileSync(path.join(here, 'hooks', f), 'utf8'), `${f} is out of date in plugins/wall-status/scripts (copy it over)`);
	assert.equal(readFileSync(path.join(here, '.claude/skills/wall-report/SKILL.md'), 'utf8'), readFileSync(path.join(here, 'plugins/wall-status/skills/wall-report/SKILL.md'), 'utf8'));
	assert.equal(readFileSync(path.join(here, '.cursor/rules/wall-report.mdc'), 'utf8'), readFileSync(path.join(here, 'plugins/wall-status/cursor/rules/wall-report.mdc'), 'utf8'));
	const hooks = JSON.parse(readFileSync(path.join(here, 'plugins/wall-status/hooks/hooks.json'), 'utf8')).hooks;
	assert.ok(hooks.PreToolUse[0].hooks[0].command.includes('${CLAUDE_PLUGIN_ROOT}/scripts/wall-status.mjs'));
	const market = JSON.parse(readFileSync(path.join(here, '.claude-plugin/marketplace.json'), 'utf8'));
	assert.equal(market.plugins[0].source, './plugins/wall-status');
	assert.equal(JSON.parse(readFileSync(path.join(here, 'plugins/wall-status/.claude-plugin/plugin.json'), 'utf8')).name, market.plugins[0].name);
});
