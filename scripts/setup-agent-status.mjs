#!/usr/bin/env node
// Set up live agent status (docs/agent-status.md) on this computer, for
// Claude Code and Cursor, or into another repository for cloud sessions.
//
//   npm run agent-status -- --url http://wall.local:3000 [--token …]
//   npm run agent-status -- --check            is it reaching the wall?
//   npm run agent-status -- --repo ../my-app   hooks, the report tool and its skill/rule into
//                                              another repo (its cloud sessions, Claude Code and Cursor)
//   npm run agent-status -- --uninstall
//   npm run agent-status -- --cursor-key KEY   on the wall: follow Cursor's cloud agents
//
// Options: --no-prompts (keep what you type off the wall), --only claude|cursor,
// --dry-run (print what would change), --home <dir> (instead of ~, for tests).
//
// On this computer it:
//   1. copies hooks/wall-status.mjs to ~/.config/smart-display/ (so the hooks
//      keep working if this checkout moves) and writes the wall's address and
//      token beside it in wall-status.json (readable only by you)
//   2. adds the hooks to ~/.claude/settings.json and ~/.cursor/hooks.json,
//      keeping everything already there; running it again changes nothing
//   3. checks the wall answers
// --uninstall takes out only what it added.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = 'wall-status.mjs';

export const CLAUDE_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SessionEnd'];
export const CURSOR_EVENTS = ['beforeSubmitPrompt', 'afterShellExecution', 'afterFileEdit', 'afterAgentResponse', 'stop', 'sessionEnd'];

const ours = (h) => typeof h?.command === 'string' && h.command.includes(MARK);

/** Claude Code settings with our hook on each event, everything else as it was. */
export function withClaudeHooks(settings = {}, command) {
	const out = withoutClaudeHooks(settings);
	out.hooks = { ...(out.hooks || {}) };
	for (const ev of CLAUDE_EVENTS) {
		out.hooks[ev] = [...(out.hooks[ev] || []), { hooks: [{ type: 'command', command, async: true, timeout: 5 }] }];
	}
	return out;
}

/** Claude Code settings with only our hooks taken out (and any event left empty by that). */
export function withoutClaudeHooks(settings = {}) {
	const out = { ...(settings || {}) };
	if (!out.hooks || typeof out.hooks !== 'object') return out;
	const hooks = {};
	for (const [ev, groups] of Object.entries(out.hooks)) {
		if (!Array.isArray(groups)) {
			hooks[ev] = groups;
			continue;
		}
		const kept = groups
			.map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !ours(h)) } : g))
			.filter((g) => !Array.isArray(g?.hooks) || g.hooks.length);
		if (kept.length || !groups.length) hooks[ev] = kept;
	}
	out.hooks = hooks;
	if (!Object.keys(hooks).length) delete out.hooks;
	return out;
}

/** Cursor hooks.json with our hook on each event, everything else as it was. */
export function withCursorHooks(config = {}, command) {
	const out = withoutCursorHooks(config);
	out.version = out.version ?? 1;
	out.hooks = { ...(out.hooks || {}) };
	for (const ev of CURSOR_EVENTS) out.hooks[ev] = [...(out.hooks[ev] || []), { command }];
	return out;
}

export function withoutCursorHooks(config = {}) {
	const out = { ...(config || {}) };
	if (!out.hooks || typeof out.hooks !== 'object') return out;
	const hooks = {};
	for (const [ev, list] of Object.entries(out.hooks)) {
		const kept = Array.isArray(list) ? list.filter((h) => !ours(h)) : list;
		if (!Array.isArray(kept) || kept.length) hooks[ev] = kept;
	}
	out.hooks = hooks;
	return out;
}

/** An MCP config ({ mcpServers }) with the wall's report tool added, everything else as it was. */
export function withWallMcp(config = {}, args) {
	const out = { ...(config || {}) };
	out.mcpServers = { ...(out.mcpServers || {}), wall: { command: 'node', args } };
	return out;
}

export function withoutWallMcp(config = {}) {
	const out = { ...(config || {}) };
	if (!out.mcpServers?.wall) return out;
	const { wall, ...rest } = out.mcpServers;
	out.mcpServers = rest;
	return out;
}

/** "http://wall.local:3000" from "wall.local:3000/", or '' when it isn't an address. */
export function normalizeUrl(raw) {
	let s = String(raw || '').trim();
	if (!s) return '';
	if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
	try {
		const u = new URL(s);
		return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
	} catch {
		return '';
	}
}

/** Did the wall answer, and what to tell the person if not. */
export async function checkWall(url, token, fetchImpl = fetch) {
	if (!url) return { ok: false, why: 'No wall address. Pass --url http://<wall>:3000.' };
	try {
		const r = await fetchImpl(`${url}/api/agents/sessions`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000) });
		if (r.status === 401) return { ok: false, why: 'The wall wants its API token. Pass --token (it is in data/api-token on the wall).' };
		if (r.status === 404) return { ok: false, why: 'The wall answered but has no agent status yet. Update it to the latest master and restart it.' };
		if (!r.ok) return { ok: false, why: `The wall answered ${r.status}.` };
		const data = await r.json();
		return { ok: true, sessions: Array.isArray(data.sessions) ? data.sessions.length : 0 };
	} catch (e) {
		return { ok: false, why: `Couldn't reach ${url} (${e.cause?.code || e.name || e.message}). Is the wall on, and is this the right address?` };
	}
}

function readJson(file) {
	if (!existsSync(file)) return {};
	const text = readFileSync(file, 'utf8').trim();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${file} isn't valid JSON, so it was left alone. Fix it and run this again.`);
	}
}

function args(argv) {
	const o = { prompts: true, only: '', dryRun: false, uninstall: false, check: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const val = () => argv[++i];
		if (a === '--url') o.url = val();
		else if (a === '--token') o.token = val();
		else if (a === '--repo') o.repo = val();
		else if (a === '--cursor-key') o.cursorKey = val();
		else if (a === '--home') o.home = val();
		else if (a === '--data-dir') o.dataDir = val();
		else if (a === '--only') o.only = val();
		else if (a === '--no-prompts') o.prompts = false;
		else if (a === '--dry-run') o.dryRun = true;
		else if (a === '--uninstall') o.uninstall = true;
		else if (a === '--check') o.check = true;
		else if (a === '-h' || a === '--help') o.help = true;
		else throw new Error(`Unknown option ${a}. Try --help.`);
	}
	return o;
}

/** Everything the run would write: [{ file, content|null (remove), mode, note }]. */
export function plan(o, { home, root = ROOT, existing = readJson } = {}) {
	const writes = [];
	const want = (tool) => !o.only || o.only === tool;
	if (o.repo) {
		// another repository: cloud sessions run the hooks in its own settings
		const repo = path.resolve(o.repo);
		const claudeFile = path.join(repo, '.claude', 'settings.json');
		const cursorFile = path.join(repo, '.cursor', 'hooks.json');
		const kit = path.join(root, 'plugins', 'wall-status');
		// copies: the hook, the report tool, and the words that tell each agent to use it
		const copies = [
			{ file: path.join(repo, 'hooks', 'wall-status.mjs'), copy: path.join(root, 'hooks', 'wall-status.mjs'), note: 'the hook script' },
			{ file: path.join(repo, 'hooks', 'wall-report.mjs'), copy: path.join(root, 'hooks', 'wall-report.mjs'), note: 'the report tool' }
		];
		if (want('claude')) copies.push({ file: path.join(repo, '.claude', 'skills', 'wall-report', 'SKILL.md'), copy: path.join(kit, 'skills', 'wall-report', 'SKILL.md'), note: 'the Claude Code skill' });
		if (want('cursor')) copies.push({ file: path.join(repo, '.cursor', 'rules', 'wall-report.mdc'), copy: path.join(kit, 'cursor', 'rules', 'wall-report.mdc'), note: 'the Cursor rule' });
		writes.push(...copies.map((c) => (o.uninstall ? { file: c.file, remove: true, note: c.note } : c)));
		if (want('claude')) {
			const cur = existing(claudeFile);
			writes.push({ file: claudeFile, content: o.uninstall ? withoutClaudeHooks(cur) : withClaudeHooks(cur, 'node "$CLAUDE_PROJECT_DIR"/hooks/wall-status.mjs claude'), note: 'Claude Code hooks' });
			const mcpFile = path.join(repo, '.mcp.json');
			const mcp = existing(mcpFile);
			writes.push({ file: mcpFile, content: o.uninstall ? withoutWallMcp(mcp) : withWallMcp(mcp, ['hooks/wall-report.mjs', '--mcp']), note: 'the report tool for Claude Code' });
		}
		if (want('cursor')) {
			const cur = existing(cursorFile);
			writes.push({ file: cursorFile, content: o.uninstall ? withoutCursorHooks(cur) : withCursorHooks(cur, 'node hooks/wall-status.mjs cursor'), note: 'Cursor hooks' });
			const mcpFile = path.join(repo, '.cursor', 'mcp.json');
			const mcp = existing(mcpFile);
			writes.push({ file: mcpFile, content: o.uninstall ? withoutWallMcp(mcp) : withWallMcp(mcp, ['${workspaceFolder}/hooks/wall-report.mjs', '--mcp']), note: 'the report tool for Cursor' });
		}
		return writes;
	}
	const dir = path.join(home, '.config', 'smart-display');
	const script = path.join(dir, 'wall-status.mjs');
	const claudeFile = path.join(home, '.claude', 'settings.json');
	const cursorFile = path.join(home, '.cursor', 'hooks.json');
	if (o.uninstall) {
		writes.push({ file: script, remove: true, note: 'the hook script' }, { file: path.join(dir, 'wall-status.json'), remove: true, note: 'the wall address and token' });
	} else {
		writes.push({ file: script, copy: path.join(root, 'hooks', 'wall-status.mjs'), note: 'the hook script' });
		const config = { url: o.url, ...(o.token ? { token: o.token } : {}), sendPrompt: o.prompts };
		writes.push({ file: path.join(dir, 'wall-status.json'), content: config, mode: 0o600, note: 'the wall address and token' });
	}
	const cmd = (tool) => `node "${script}" ${tool}`;
	if (want('claude')) {
		const cur = existing(claudeFile);
		writes.push({ file: claudeFile, content: o.uninstall ? withoutClaudeHooks(cur) : withClaudeHooks(cur, cmd('claude')), note: 'Claude Code hooks' });
	}
	if (want('cursor')) {
		const cur = existing(cursorFile);
		writes.push({ file: cursorFile, content: o.uninstall ? withoutCursorHooks(cur) : withCursorHooks(cur, cmd('cursor')), note: 'Cursor hooks' });
	}
	return writes;
}

function apply(writes, dryRun, log) {
	for (const w of writes) {
		if (dryRun) {
			log(`would ${w.remove ? 'remove' : 'write'} ${w.file} (${w.note})`);
			if (w.content && !w.remove) log(JSON.stringify(redact(w.content), null, 2));
			continue;
		}
		if (w.remove) {
			rmSync(w.file, { force: true });
			continue;
		}
		mkdirSync(path.dirname(w.file), { recursive: true });
		if (w.copy) copyFileSync(w.copy, w.file);
		else writeFileSync(w.file, `${JSON.stringify(w.content, null, 2)}\n`, { mode: w.mode ?? 0o644 });
		if (w.mode) chmodSync(w.file, w.mode);
		log(`${w.note}: ${w.file}`);
	}
}

const redact = (c) => (c && typeof c === 'object' && 'token' in c ? { ...c, token: '…' } : c);

async function main(argv = process.argv.slice(2), log = console.log) {
	const o = args(argv);
	if (o.help) {
		log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
		return 0;
	}
	if (o.only && !['claude', 'cursor'].includes(o.only)) throw new Error('--only takes claude or cursor.');
	const home = o.home || homedir();
	const saved = readJson(path.join(home, '.config', 'smart-display', 'wall-status.json'));
	o.url = normalizeUrl(o.url || saved.url);
	o.token = o.token ?? saved.token ?? '';
	// on the wall itself, its own token is right here
	if (!o.token && existsSync(path.join(ROOT, 'data', 'api-token'))) o.token = readFileSync(path.join(ROOT, 'data', 'api-token'), 'utf8').trim();

	if (o.cursorKey !== undefined) {
		// run on the wall: it reads data/cursor-api-key every minute (src/lib/server/agentStatusHub.js)
		const file = path.join(o.dataDir || path.join(ROOT, 'data'), 'cursor-api-key');
		const key = String(o.cursorKey || '').trim();
		if (o.dryRun) log(`would ${key ? 'write' : 'remove'} ${file}`);
		else if (!key) rmSync(file, { force: true });
		else {
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(file, `${key}\n`, { mode: 0o600 });
			chmodSync(file, 0o600);
		}
		log(key ? 'Cursor API key saved on the wall. Its cloud agents show within a minute.' : 'Cursor API key removed.');
		return 0;
	}
	if (o.check) {
		const c = await checkWall(o.url, o.token);
		log(c.ok ? `The wall answers at ${o.url} (${c.sessions} sessions known).` : c.why);
		return c.ok ? 0 : 1;
	}
	if (!o.uninstall && !o.repo && !o.url) throw new Error('Which wall? Pass --url http://<wall>:3000 (or its tunnel address).');

	apply(plan(o, { home }), o.dryRun, log);
	if (o.uninstall) {
		log('Agent status hooks removed. Restart Claude Code and Cursor to drop them from open sessions.');
		return 0;
	}
	if (o.repo) {
		log('Commit those files in that repo. Cloud sessions also need WALL_URL and WALL_TOKEN in the cloud environment, and the wall reachable from the internet (docs/agent-status.md).');
		return 0;
	}
	const c = o.dryRun ? { ok: true, sessions: 0 } : await checkWall(o.url, o.token);
	log(c.ok ? `Done. The wall answers at ${o.url}. New Claude Code and Cursor sessions will show on it; restart open ones.` : `Set up, but: ${c.why}`);
	return c.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main()
		.then((code) => process.exit(code))
		.catch((e) => {
			console.error(e.message);
			process.exit(2);
		});
}

export { main };
