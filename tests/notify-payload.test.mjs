import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	DEFAULT_NOTIFY_TTL,
	agentFinishedNotify,
	parseBtConnectedPayload,
	parseNotifyPayload
} from '../src/lib/server/notifyPayload.js';

test('parseNotifyPayload requires a title unless event is done', () => {
	assert.equal(parseNotifyPayload({}).error, 'title required');
	assert.equal(parseNotifyPayload({ body: 'hi' }).error, 'title required');
});

test('event done fills Cursor / Claude Code / Agent titles', () => {
	assert.deepEqual(parseNotifyPayload({ event: 'done', source: 'Cursor' }).notify, {
		type: 'notify',
		title: 'Cursor finished',
		body: '',
		severity: 'ok',
		source: 'Cursor',
		ttl: DEFAULT_NOTIFY_TTL
	});
	assert.equal(
		parseNotifyPayload({ event: 'done', source: 'Claude Code' }).notify.title,
		'Claude Code finished'
	);
	assert.equal(parseNotifyPayload({ event: 'done' }).notify.title, 'Agent finished');
});

test('explicit title still wins over event done', () => {
	const { notify } = parseNotifyPayload({
		event: 'done',
		source: 'Cursor',
		title: 'PR checks green',
		body: 'all 12 passed',
		severity: 'ok',
		ttl: 12000
	});
	assert.equal(notify.title, 'PR checks green');
	assert.equal(notify.body, 'all 12 passed');
	assert.equal(notify.ttl, 12000);
});

test('ttl defaults to 9s and clamps', () => {
	assert.equal(parseNotifyPayload({ title: 'Hi' }).notify.ttl, DEFAULT_NOTIFY_TTL);
	assert.equal(parseNotifyPayload({ title: 'Hi', ttl: 200 }).notify.ttl, 1000);
	assert.equal(parseNotifyPayload({ title: 'Hi', ttl: 99999 }).notify.ttl, 30000);
});

test('bluetooth payload uses the device name when present', () => {
	assert.deepEqual(parseBtConnectedPayload('').notify.title, 'Phone connected');
	assert.equal(parseBtConnectedPayload('{"name":"Pixel 9"}').notify.title, 'Pixel 9 connected');
	assert.equal(parseBtConnectedPayload('{"alias":"Avi\'s iPhone"}').notify.source, 'Bluetooth');
	assert.equal(parseBtConnectedPayload('not-json').notify.title, 'Phone connected');
});

test('agentFinishedNotify is the Ollama idle island event', () => {
	const msg = agentFinishedNotify();
	assert.equal(msg.title, 'Agent finished');
	assert.equal(msg.source, 'Ollama');
	assert.equal(msg.severity, 'ok');
	assert.equal(msg.ttl, DEFAULT_NOTIFY_TTL);
});
