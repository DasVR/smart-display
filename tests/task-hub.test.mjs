import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskHub } from '../src/lib/server/taskHub.js';

const quiet = { log() {}, warn() {}, error() {} };

/** Spin up the hub behind a real HTTP server on a random port. */
async function harness({ token, nowRef = { t: new Date(2026, 9, 5, 12).getTime() } } = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'hub-'));
	if (token) writeFileSync(path.join(dataDir, 'api-token'), token);
	const sent = [];
	const hub = createTaskHub({ dataDir, broadcast: (m) => sent.push(m), log: quiet, now: () => nowRef.t, env: {} });
	const server = createServer(async (req, res) => {
		if (!(await hub.handleHttp(req, res))) {
			res.writeHead(404);
			res.end();
		}
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const call = async (method, p, body, headers = {}) => {
		const res = await fetch(base + p, {
			method,
			headers: { 'Content-Type': 'application/json', ...headers },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		return { status: res.status, data: await res.json().catch(() => null) };
	};
	return { hub, sent, call, nowRef, dataDir, close: () => new Promise((r) => server.close(r)) };
}

test('create, list, edit, complete and delete over HTTP', async () => {
	const h = await harness();
	try {
		const at = new Date(2026, 9, 5, 18).toISOString();
		const created = await h.call('POST', '/api/tasks', { title: 'Bins', at, repeat: { freq: 'weekly', days: [1, 4] }, source: 'Tomo' });
		assert.equal(created.status, 201);
		const id = created.data.task.id;
		assert.equal(created.data.task.status, 'today');
		assert.equal(created.data.task.repeatText, 'Every week on Mon, Thu');

		const list = await h.call('GET', '/api/tasks?status=today');
		assert.deepEqual(list.data.tasks.map((t) => t.title), ['Bins']);

		const edited = await h.call('PATCH', `/api/tasks/${id}`, { notes: 'Blue bin too' });
		assert.equal(edited.data.task.notes, 'Blue bin too');

		const done = await h.call('POST', `/api/tasks/${id}/done`);
		assert.equal(done.data.task.doneCount, 1);
		assert.equal(new Date(done.data.task.nextDue).getDate(), 8); // Thursday

		assert.equal((await h.call('DELETE', `/api/tasks/${id}`)).status, 200);
		assert.equal((await h.call('GET', `/api/tasks/${id}`)).status, 404);
		assert.ok(h.sent.some((m) => m.type === 'tasks'), 'changes broadcast to the kiosk');
	} finally {
		await h.close();
	}
});

test('bad input gets a 400 with a reason, unknown routes a 404', async () => {
	const h = await harness();
	try {
		const bad = await h.call('POST', '/api/tasks', { title: '' });
		assert.equal(bad.status, 400);
		assert.match(bad.data.error, /title/);
		assert.equal((await h.call('POST', '/api/tasks/nope/done')).status, 404);
		assert.equal((await h.call('POST', '/api/tasks/nope/explode')).status, 404);
	} finally {
		await h.close();
	}
});

test('a configured token locks the API', async () => {
	const h = await harness({ token: 'tok' });
	try {
		assert.equal((await h.call('GET', '/api/tasks')).status, 401);
		assert.equal((await h.call('GET', '/api/tasks', undefined, { Authorization: 'Bearer nope' })).status, 401);
		assert.equal((await h.call('GET', '/api/tasks', undefined, { Authorization: 'Bearer tok' })).status, 200);
	} finally {
		await h.close();
	}
});

test('the tick raises due items on the island once, and webhooks hear about them', async () => {
	const delivered = [];
	const dataDir = mkdtempSync(path.join(tmpdir(), 'hub-'));
	const nowRef = { t: new Date(2026, 9, 5, 17, 59).getTime() };
	const sent = [];
	const hub = createTaskHub({
		dataDir,
		broadcast: (m) => sent.push(m),
		log: quiet,
		now: () => nowRef.t,
		env: {},
		fetchImpl: async (url, init) => {
			delivered.push({ url, event: init.headers['X-Display-Event'] });
			return { ok: true, status: 200 };
		}
	});
	const server = createServer(async (req, res) => {
		await hub.handleHttp(req, res);
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	try {
		const base = `http://127.0.0.1:${server.address().port}`;
		await fetch(`${base}/api/webhooks`, {
			method: 'POST',
			body: JSON.stringify({ url: 'http://tomo.local/hook', events: ['task.due'], name: 'Tomo' })
		});
		hub.create({ title: 'Take meds', kind: 'alert', at: new Date(2026, 9, 5, 18).toISOString(), repeat: 'daily' });

		assert.equal(hub.tick().length, 0, 'not due yet');
		nowRef.t = new Date(2026, 9, 5, 18, 0, 20).getTime();
		const fired = hub.tick();
		assert.deepEqual(fired.map((t) => t.title), ['Take meds']);
		assert.equal(hub.tick().length, 0, 'fires once per occurrence');

		const notify = sent.find((m) => m.type === 'notify');
		assert.equal(notify.title, 'Take meds');
		assert.equal(notify.kind, 'alert');
		await new Promise((r) => setTimeout(r, 20));
		assert.deepEqual(delivered, [{ url: 'http://tomo.local/hook', event: 'task.due' }]);

		const list = await (await fetch(`${base}/api/webhooks`)).json();
		assert.equal(list.webhooks[0].name, 'Tomo');
	} finally {
		hub.stop();
		await new Promise((r) => server.close(r));
	}
});

test('WebSocket ops mirror the API for the kiosk and phone', async () => {
	const h = await harness();
	try {
		const { task } = h.hub.handleWs({ type: 'tasks', op: 'create', task: { title: 'Water plants', at: new Date(2026, 9, 5, 9).toISOString() } });
		assert.equal(task.status, 'overdue');
		const snoozed = h.hub.handleWs({ type: 'tasks', op: 'snooze', id: task.id, minutes: 30 }).task;
		assert.equal(snoozed.status, 'snoozed');
		h.hub.handleWs({ type: 'tasks', op: 'done', id: task.id });
		assert.equal(h.hub.snapshot()[0].status, 'done');
		assert.equal(h.hub.handleWs({ type: 'other' }), null);
	} finally {
		await h.close();
	}
});
