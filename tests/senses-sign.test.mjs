import test from 'node:test';
import assert from 'node:assert/strict';
import { guestTitle, sensesSign, signLabel, signVisible } from '../src/lib/sensesSign.js';
import { DEFAULT_SENSES, normalizeSensesSettings } from '../src/lib/senses.js';

const on = { settings: { camera: true, mic: true }, online: true, camera: { ok: true }, mic: { ok: true, state: 'listening' } };

test('the sign says what is on', () => {
	assert.deepEqual(sensesSign(on), { camera: 'on', mic: 'on', notes: false, guest: false, label: 'Camera on · Microphone on' });
	assert.equal(sensesSign({ ...on, mic: { ok: true, state: 'thinking' } }).mic, 'hearing');
	assert.equal(sensesSign({ ...on, notes: { on: true } }).label, 'Camera on · Microphone on, taking notes');
});

test('turned on but not answering is down, never "on"', () => {
	const off = sensesSign({ ...on, online: false });
	assert.equal(off.camera, 'down');
	assert.equal(off.mic, 'down');
	assert.equal(sensesSign({ ...on, mic: { ok: false, error: 'no-parec' } }).mic, 'down');
	assert.equal(sensesSign({ ...on, camera: { error: 'busy' } }).camera, 'down');
});

test('nothing on: no sign', () => {
	const s = sensesSign({ settings: { camera: false, mic: false }, online: true });
	assert.equal(signVisible(s), false);
	assert.equal(signVisible(sensesSign({})), false);
	assert.equal(signVisible(sensesSign({ settings: { mic: true }, online: true, mic: { ok: true } })), true);
	assert.equal(signLabel({ camera: 'off', mic: 'down', notes: false }), 'Camera off · Microphone not answering');
});

test('Guest mode is off by default and only true turns it on', () => {
	assert.equal(DEFAULT_SENSES.guest, false);
	assert.equal(normalizeSensesSettings({}).guest, false);
	assert.equal(normalizeSensesSettings({ guest: 'yes' }).guest, false);
	assert.equal(normalizeSensesSettings({ guest: true }).guest, true);
	assert.equal(normalizeSensesSettings({ mic: true }, { ...DEFAULT_SENSES, guest: true }).guest, true, 'other changes keep it');
	assert.equal(sensesSign({ settings: { guest: true } }).guest, true);
	assert.equal(guestTitle('Dentist', true), 'Busy');
	assert.equal(guestTitle('Dentist', false), 'Dentist');
});
