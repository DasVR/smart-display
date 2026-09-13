import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chimeKindForEvent, volumeTickPitch } from '../src/lib/chimeKind.js';

test('volumeTickPitch clamps to 0..1', () => {
	assert.equal(volumeTickPitch(0), 0);
	assert.equal(volumeTickPitch(0.72), 0.72);
	assert.equal(volumeTickPitch(2), 1);
	assert.equal(volumeTickPitch(-1), 0);
	assert.equal(volumeTickPitch('nope'), 0.45);
});

test('chimeKindForEvent maps volume, schedule, install, update', () => {
	assert.equal(chimeKindForEvent({ kind: 'volume' }), 'volume');
	assert.equal(chimeKindForEvent({ kind: 'volume', muted: true }), 'mute');
	assert.equal(chimeKindForEvent({ kind: 'schedule' }), 'schedule');
	assert.equal(chimeKindForEvent({ kind: 'install' }), 'install');
	assert.equal(chimeKindForEvent({ kind: 'update' }), 'update');
	assert.equal(chimeKindForEvent({ kind: 'update', severity: 'ok' }), 'success');
});

test('chimeKindForEvent gives Cursor, Claude, Hermes, and Ollama their own finish sounds', () => {
	assert.equal(chimeKindForEvent({ kind: 'done', source: 'Cursor' }), 'done-cursor');
	assert.equal(chimeKindForEvent({ kind: 'done', source: 'Claude Code' }), 'done-claude');
	assert.equal(chimeKindForEvent({ kind: 'done', source: 'Hermes' }), 'done-hermes');
	assert.equal(chimeKindForEvent({ kind: 'done', source: 'Ollama' }), 'done-ollama');
	assert.equal(chimeKindForEvent({ title: 'Cursor finished', source: 'Cursor' }), 'done-cursor');
	assert.equal(chimeKindForEvent({ kind: 'done' }), 'success');
});

test('chimeKindForEvent keeps weather and severity fallbacks', () => {
	assert.equal(chimeKindForEvent({ kind: 'severe-weather' }), 'severe');
	assert.equal(chimeKindForEvent({ severity: 'error' }), 'error');
	assert.equal(chimeKindForEvent({ severity: 'ok' }), 'ok');
});
