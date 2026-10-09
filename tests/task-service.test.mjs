import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import {
	authorized,
	deliverWebhooks,
	loadApiToken,
	loadTasks,
	mintApiToken,
	normalizeWebhook,
	publicWebhook,
	saveTasks,
	signBody
} from '../src/lib/server/taskService.js';

const dir = () => mkdtempSync(path.join(tmpdir(), 'tasks-'));

test('tasks round-trip through the JSON store; a missing file is an empty list', () => {
	const file = path.join(dir(), 'nested', 'tasks.json');
	assert.deepEqual(loadTasks(file), []);
	saveTasks(file, [{ id: 'a', title: 'Bins' }]);
	assert.deepEqual(loadTasks(file), [{ id: 'a', title: 'Bins' }]);
	assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
});

test('auth is open with no token, and exact-match bearer once one exists', () => {
	assert.equal(authorized({}, ''), true);
	assert.equal(authorized({}, 'secret'), false);
	assert.equal(authorized({ authorization: 'Bearer secret' }, 'secret'), true);
	assert.equal(authorized({ authorization: 'bearer secret' }, 'secret'), true);
	assert.equal(authorized({ authorization: 'Bearer secre' }, 'secret'), false);
	assert.equal(authorized({ authorization: 'Basic secret' }, 'secret'), false);
});

test('the token comes from the env first, then the minted file (mode 600)', () => {
	const file = path.join(dir(), 'api-token');
	assert.equal(loadApiToken(file, {}), '');
	const minted = mintApiToken(file);
	assert.equal(loadApiToken(file, {}), minted);
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.equal(loadApiToken(file, { DISPLAY_API_TOKEN: 'from-env' }), 'from-env');
});

test('webhook subscribers are validated and their secrets never listed', () => {
	assert.match(normalizeWebhook({ url: 'ftp://x' }).error, /http/);
	assert.match(normalizeWebhook({ url: 'not a url' }).error, /absolute/);
	assert.match(normalizeWebhook({ url: 'http://a', events: ['task.nope'] }).error, /unknown events/);
	const { hook } = normalizeWebhook({ url: 'http://tomo.local/hook', events: ['task.due'], secret: 's3', name: 'Tomo' });
	assert.deepEqual(hook.events, ['task.due']);
	const shown = publicWebhook(hook);
	assert.equal(shown.secret, undefined);
	assert.equal(shown.signed, true);
});

test('deliveries go only to subscribers of the event, signed when a secret is set', async () => {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		return { ok: true, status: 200 };
	};
	const hooks = [
		{ id: '1', url: 'http://tomo/hook', events: ['task.due'], secret: 'k' },
		{ id: '2', url: 'http://instinct/hook', events: ['task.done'], secret: '' }
	];
	await deliverWebhooks(hooks, 'task.due', { task: { id: 't', title: 'Bins' } }, { fetchImpl, now: 0 });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'http://tomo/hook');
	const { headers, body } = calls[0].init;
	assert.equal(headers['X-Display-Event'], 'task.due');
	const expected = `sha256=${createHmac('sha256', 'k').update(body).digest('hex')}`;
	assert.equal(headers['X-Display-Signature'], expected);
	assert.equal(signBody('k', body), expected);
	assert.equal(JSON.parse(body).task.title, 'Bins');
});

test('a failing subscriber never throws out of deliverWebhooks', async () => {
	const hooks = [{ id: '1', url: 'http://down/hook', events: ['task.due'], secret: '' }];
	const fetchImpl = async () => {
		throw new Error('ECONNREFUSED');
	};
	const results = await deliverWebhooks(hooks, 'task.due', {}, { fetchImpl, log: {} });
	assert.equal(results[0].status, 'rejected');
});
