import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskHub } from '../src/lib/server/taskHub.js';
import { createSensesHub } from '../src/lib/server/sensesHub.js';
import { createVoiceHub } from '../src/lib/server/voiceHub.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, warn() {}, error() {} };

test('the MCP bridge lists tools and drives the task API end to end', async () => {
	const notices = [];
	const hub = createTaskHub({ dataDir: mkdtempSync(path.join(tmpdir(), 'mcp-')), broadcast: () => {}, log: quiet, env: {} });
	const server = createServer(async (req, res) => {
		if (await hub.handleHttp(req, res)) return;
		if (req.url === '/api/notify') {
			let raw = '';
			req.on('data', (c) => (raw += c));
			req.on('end', () => {
				notices.push(JSON.parse(raw));
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end('{"ok":true}');
			});
			return;
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));

	const child = spawn(process.execPath, [path.join(root, 'scripts/tasks-mcp.mjs')], {
		env: { ...process.env, DISPLAY_URL: `http://127.0.0.1:${server.address().port}`, DISPLAY_SOURCE: 'Tomo' }
	});
	const pending = new Map();
	let buf = '';
	child.stdout.on('data', (d) => {
		buf += d;
		let i;
		while ((i = buf.indexOf('\n')) >= 0) {
			const msg = JSON.parse(buf.slice(0, i));
			buf = buf.slice(i + 1);
			pending.get(msg.id)?.(msg);
		}
	});
	let nextId = 1;
	const rpc = (method, params) =>
		new Promise((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
		});

	try {
		const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } });
		assert.equal(init.result.serverInfo.name, 'smart-display-tasks');
		child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

		const tools = (await rpc('tools/list')).result.tools.map((t) => t.name);
		assert.deepEqual(tools, ['list_tasks', 'add_task', 'update_task', 'complete_task', 'snooze_task', 'delete_task', 'room_presence', 'say_on_wall', 'list_wall_notes', 'read_wall_note', 'notify_display', 'run_wall_intent']);

		const added = await rpc('tools/call', { name: 'add_task', arguments: { title: 'Feed the cat', repeat: 'daily' } });
		const task = JSON.parse(added.result.content[0].text).task;
		assert.equal(task.source, 'Tomo', 'items carry the assistant name');

		const done = await rpc('tools/call', { name: 'complete_task', arguments: { id: task.id } });
		assert.equal(JSON.parse(done.result.content[0].text).task.doneCount, 1);

		const bad = await rpc('tools/call', { name: 'add_task', arguments: { title: '' } });
		assert.equal(bad.result.isError, true);
		assert.match(bad.result.content[0].text, /title/);

		await rpc('tools/call', { name: 'notify_display', arguments: { title: 'Dinner in 10' } });
		assert.deepEqual(notices, [{ source: 'Tomo', title: 'Dinner in 10' }]);

		const unknown = await rpc('tools/call', { name: 'launch_rockets', arguments: {} });
		assert.equal(unknown.error.code, -32602);
		assert.equal((await rpc('resources/list')).error.code, -32601);
	} finally {
		child.kill();
		await new Promise((r) => server.close(r));
	}
});

test('the MCP bridge tells an assistant who is in the room, speaks, and reads notes', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'mcp-senses-'));
	const env = { DISPLAY_API_TOKEN: 'tok-123456789' };
	const spoken = [];
	const senses = createSensesHub({ dataDir, broadcast: () => {}, command: async () => null, say: async () => {}, isLocal: () => false, env, log: () => {} });
	const voice = createVoiceHub({ dataDir, broadcast: (m) => m.type === 'speak' && spoken.push(m), env, log: { warn() {} }, room: () => senses.presence() });
	senses.setSettings({ camera: true, mic: true });
	senses.startNotes();
	await senses.heard('note', 'buy oat milk');
	senses.stopNotes();
	const server = createServer(async (req, res) => {
		if (await senses.handleHttp(req, res)) return;
		if (await voice.handleHttp(req, res)) return;
		res.writeHead(404);
		res.end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const child = spawn(process.execPath, [path.join(root, 'scripts/tasks-mcp.mjs')], {
		env: { ...process.env, DISPLAY_URL: `http://127.0.0.1:${server.address().port}`, DISPLAY_SOURCE: 'Agent', DISPLAY_API_TOKEN: env.DISPLAY_API_TOKEN }
	});
	const pending = new Map();
	let buf = '';
	child.stdout.on('data', (d) => {
		buf += d;
		let i;
		while ((i = buf.indexOf('\n')) >= 0) {
			const msg = JSON.parse(buf.slice(0, i));
			buf = buf.slice(i + 1);
			pending.get(msg.id)?.(msg);
		}
	});
	let nextId = 1;
	const call = (name, args = {}) =>
		new Promise((resolve) => {
			const id = nextId++;
			pending.set(id, (msg) => resolve(msg.result));
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
		});
	try {
		const room = JSON.parse((await call('room_presence')).content[0].text);
		assert.deepEqual(room, { webcam: false, people: 0, spot: null, posture: null, metres: null, nearTheWall: false, takingNotes: false });
		const said = JSON.parse((await call('say_on_wall', { text: 'Dinner is ready' })).content[0].text);
		assert.equal(said.text, 'Dinner is ready.');
		assert.equal(spoken.at(-1).source, 'Agent');
		const list = JSON.parse((await call('list_wall_notes')).content[0].text).notes;
		assert.equal(list.length, 1);
		const note = JSON.parse((await call('read_wall_note', { name: list[0] })).content[0].text).text;
		assert.match(note, /buy oat milk/);
		assert.equal((await call('read_wall_note', { name: '../api-token' })).isError, true);
	} finally {
		child.kill();
		await new Promise((r) => server.close(r));
	}
});
