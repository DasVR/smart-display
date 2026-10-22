import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	CLAUDE_EVENTS,
	CURSOR_EVENTS,
	checkWall,
	main,
	normalizeUrl,
	withClaudeHooks,
	withCursorHooks,
	withoutClaudeHooks,
	withoutCursorHooks
} from '../scripts/setup-agent-status.mjs';
import { savedConfig } from '../hooks/wall-status.mjs';

const CMD = 'node "/home/me/.config/smart-display/wall-status.mjs" claude';

test('Claude Code: our hooks go in beside yours, once, and come out cleanly', () => {
	const mine = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
	const once = withClaudeHooks(mine, CMD);
	assert.equal(once.model, 'opus');
	assert.deepEqual(Object.keys(once.hooks).sort(), [...CLAUDE_EVENTS].sort());
	assert.equal(once.hooks.Stop.length, 2, 'yours stays first');
	assert.equal(once.hooks.Stop[0].hooks[0].command, 'say done');
	assert.deepEqual(withClaudeHooks(once, CMD), once, 'running it again changes nothing');
	assert.deepEqual(withoutClaudeHooks(once), mine);
	assert.deepEqual(withoutClaudeHooks({ theme: 'dark' }), { theme: 'dark' });
	// an older install at another path is replaced, not doubled
	const moved = withClaudeHooks(once, 'node "/elsewhere/hooks/wall-status.mjs" claude');
	assert.equal(moved.hooks.PreToolUse.length, 1);
});

test('Cursor: the same, in hooks.json', () => {
	const mine = { version: 1, hooks: { stop: [{ command: './notify.sh' }] } };
	const once = withCursorHooks(mine, 'node x/wall-status.mjs cursor');
	assert.deepEqual(Object.keys(once.hooks).sort(), [...CURSOR_EVENTS].sort());
	assert.equal(once.hooks.stop.length, 2);
	assert.deepEqual(withCursorHooks(once, 'node x/wall-status.mjs cursor'), once);
	assert.deepEqual(withoutCursorHooks(once), mine);
	assert.equal(withCursorHooks({}, 'c wall-status.mjs').version, 1);
});

test('wall addresses', () => {
	assert.equal(normalizeUrl('wall.local:3000/'), 'http://wall.local:3000');
	assert.equal(normalizeUrl('https://wall.tail1234.ts.net'), 'https://wall.tail1234.ts.net');
	assert.equal(normalizeUrl(''), '');
	assert.equal(normalizeUrl('http://'), '');
});

async function fakeWall(handler) {
	const server = createServer(handler);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('checking the wall says what is wrong in words', async () => {
	const wall = await fakeWall((req, res) => {
		if (req.headers.authorization !== 'Bearer tok') return res.writeHead(401).end();
		res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sessions: [{}, {}] }));
	});
	try {
		assert.deepEqual(await checkWall(wall.url, 'tok'), { ok: true, sessions: 2 });
		assert.match((await checkWall(wall.url, '')).why, /API token/);
		assert.match((await checkWall('', '')).why, /--url/);
		assert.match((await checkWall('http://127.0.0.1:1', '')).why, /Couldn't reach/);
	} finally {
		wall.close();
	}
});

test('a whole install into a home folder, then out again', async () => {
	const home = mkdtempSync(path.join(tmpdir(), 'home-'));
	mkdirSync(path.join(home, '.claude'), { recursive: true });
	writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }));
	const wall = await fakeWall((req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"sessions":[]}'));
	const lines = [];
	try {
		assert.equal(await main(['--url', wall.url.replace('http://', ''), '--token', 'tok', '--no-prompts', '--home', home], (l) => lines.push(l)), 0);
	} finally {
		wall.close();
	}
	const cfgFile = path.join(home, '.config', 'smart-display', 'wall-status.json');
	assert.deepEqual(JSON.parse(readFileSync(cfgFile, 'utf8')), { url: wall.url, token: 'tok', sendPrompt: false });
	assert.equal(statSync(cfgFile).mode & 0o777, 0o600, 'the token is only yours to read');
	assert.deepEqual(savedConfig({ HOME: home }), { url: wall.url, token: 'tok', sendPrompt: false });
	assert.ok(existsSync(path.join(home, '.config', 'smart-display', 'wall-status.mjs')));
	const claude = JSON.parse(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
	assert.equal(claude.theme, 'dark');
	assert.match(claude.hooks.Stop[0].hooks[0].command, /\.config\/smart-display\/wall-status\.mjs" claude$/);
	assert.ok(JSON.parse(readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8')).hooks.beforeSubmitPrompt);
	assert.match(lines.at(-1), /^Done/);

	assert.equal(await main(['--uninstall', '--home', home], () => {}), 0);
	assert.deepEqual(JSON.parse(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')), { theme: 'dark' });
	assert.ok(!existsSync(cfgFile));
});

test('broken settings are left alone, not overwritten', async () => {
	const home = mkdtempSync(path.join(tmpdir(), 'home-'));
	mkdirSync(path.join(home, '.claude'), { recursive: true });
	writeFileSync(path.join(home, '.claude', 'settings.json'), '{ nope');
	await assert.rejects(main(['--url', 'wall:3000', '--home', home, '--dry-run'], () => {}), /isn't valid JSON/);
	assert.equal(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ nope');
});

test('into another repo, for its cloud sessions', async () => {
	const repo = mkdtempSync(path.join(tmpdir(), 'repo-'));
	assert.equal(await main(['--repo', repo], () => {}), 0);
	const s = JSON.parse(readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
	assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].command, 'node "$CLAUDE_PROJECT_DIR"/hooks/wall-status.mjs claude');
	assert.ok(existsSync(path.join(repo, 'hooks', 'wall-status.mjs')));
	assert.equal(JSON.parse(readFileSync(path.join(repo, '.cursor', 'hooks.json'), 'utf8')).hooks.stop[0].command, 'node hooks/wall-status.mjs cursor');
	// the report tool, and the words telling each agent to use it
	assert.ok(existsSync(path.join(repo, 'hooks', 'wall-report.mjs')));
	assert.ok(existsSync(path.join(repo, '.claude', 'skills', 'wall-report', 'SKILL.md')));
	assert.ok(existsSync(path.join(repo, '.cursor', 'rules', 'wall-report.mdc')));
	assert.deepEqual(JSON.parse(readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers.wall.args, ['hooks/wall-report.mjs', '--mcp']);
	assert.deepEqual(JSON.parse(readFileSync(path.join(repo, '.cursor', 'mcp.json'), 'utf8')).mcpServers.wall.args, ['${workspaceFolder}/hooks/wall-report.mjs', '--mcp']);
});

test('another repo keeps its own MCP servers, and uninstall takes out only ours', async () => {
	const repo = mkdtempSync(path.join(tmpdir(), 'repo-'));
	writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'db-mcp' } } }));
	await main(['--repo', repo], () => {});
	assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers).sort(), ['db', 'wall']);
	await main(['--repo', repo, '--uninstall'], () => {});
	assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers), ['db']);
	assert.ok(!existsSync(path.join(repo, 'hooks', 'wall-report.mjs')));
	assert.ok(!existsSync(path.join(repo, '.cursor', 'rules', 'wall-report.mdc')));
});

test('the Cursor key is saved on the wall, for it alone to read', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'data-'));
	assert.equal(await main(['--cursor-key', 'key_123', '--data-dir', dataDir], () => {}), 0);
	const file = path.join(dataDir, 'cursor-api-key');
	assert.equal(readFileSync(file, 'utf8'), 'key_123\n');
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.equal(await main(['--cursor-key', '', '--data-dir', dataDir], () => {}), 0);
	assert.ok(!existsSync(file));
});
