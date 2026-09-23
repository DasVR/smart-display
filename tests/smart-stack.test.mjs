import test from 'node:test';
import assert from 'node:assert/strict';
import {
	decideSmartStack,
	isStandBy,
	HANDS_OFF_MS,
	IDLE_RETURN_MS,
	STANDBY_IDLE_MS
} from '../src/lib/smartStack.js';

const NOW = 1_000_000_000;
const idle = (ms) => NOW - ms;

test('does nothing while someone is interacting', () => {
	const r = decideSmartStack({ view: 'clock', now: NOW, lastInput: idle(1000), playing: true, wasPlaying: false });
	assert.equal(r, null);
});

test('playback starting on Clock jumps to Music and remembers the origin', () => {
	const r = decideSmartStack({ view: 'clock', now: NOW, lastInput: idle(HANDS_OFF_MS), playing: true, wasPlaying: false });
	assert.deepEqual(r, { view: 'music', autoFrom: 'clock', reason: 'playback-started' });
});

test('playback starting on another view leaves it alone', () => {
	const r = decideSmartStack({ view: 'school', now: NOW, lastInput: idle(HANDS_OFF_MS), playing: true, wasPlaying: false });
	assert.equal(r, null);
});

test('playback stopping returns only when we moved it', () => {
	const back = decideSmartStack({ view: 'music', now: NOW, lastInput: idle(HANDS_OFF_MS), playing: false, wasPlaying: true, autoFrom: 'clock' });
	assert.deepEqual(back, { view: 'clock', autoFrom: null, reason: 'playback-stopped' });
	const stay = decideSmartStack({ view: 'music', now: NOW, lastInput: idle(HANDS_OFF_MS), playing: false, wasPlaying: true, autoFrom: null });
	assert.equal(stay, null);
});

test('long idle drifts back to Clock, but not off a playing Music view', () => {
	const r = decideSmartStack({ view: 'weather', now: NOW, lastInput: idle(IDLE_RETURN_MS), playing: false, wasPlaying: false });
	assert.equal(r?.view, 'clock');
	const music = decideSmartStack({ view: 'music', now: NOW, lastInput: idle(IDLE_RETURN_MS), playing: true, wasPlaying: true });
	assert.equal(music, null);
});

test('StandBy needs night, the clock, normal mode and idle time', () => {
	const base = { view: 'clock', phase: 'night', now: NOW, lastInput: idle(STANDBY_IDLE_MS) };
	assert.equal(isStandBy(base), true);
	assert.equal(isStandBy({ ...base, phase: 'day' }), false);
	assert.equal(isStandBy({ ...base, view: 'music' }), false);
	assert.equal(isStandBy({ ...base, mode: 'sleep' }), false);
	assert.equal(isStandBy({ ...base, lastInput: idle(1000) }), false);
});
