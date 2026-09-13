import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	activeLyricIndex,
	activeWordIndex,
	livePlaybackPosition,
	lyricsAreSynced
} from '../src/lib/playbackClock.js';

test('livePlaybackPosition holds still when paused', () => {
	assert.equal(
		livePlaybackPosition({ playing: false, position: 12.4, positionAt: 1_000, length: 200 }, 5_000),
		12.4
	);
});

test('livePlaybackPosition extrapolates from positionAt, not updatedAt', () => {
	const track = {
		playing: true,
		position: 10,
		positionAt: 1_000,
		updatedAt: 4_000,
		length: 200
	};
	assert.equal(livePlaybackPosition(track, 3_000), 12);
});

test('livePlaybackPosition ignores a heartbeat that only refreshed updatedAt', () => {
	const sampled = { playing: true, position: 10, positionAt: 1_000, length: 273 };
	assert.equal(livePlaybackPosition(sampled, 2_000), 11);
	const heartbeat = { ...sampled, updatedAt: 2_000 };
	assert.equal(livePlaybackPosition(heartbeat, 2_000), 11);
});

test('livePlaybackPosition caps at track length', () => {
	assert.equal(
		livePlaybackPosition({ playing: true, position: 198, positionAt: 0, length: 200 }, 10_000),
		198
	);
	assert.equal(
		livePlaybackPosition({ playing: true, position: 198, positionAt: 1_000, length: 200 }, 10_000),
		200
	);
});

test('activeLyricIndex follows the last line that has started', () => {
	const lines = [
		{ time: 0.5, text: 'one' },
		{ time: 4, text: 'two' },
		{ time: 8, text: 'three' }
	];
	assert.equal(activeLyricIndex(lines, 0), -1);
	assert.equal(activeLyricIndex(lines, 0.5), 0);
	assert.equal(activeLyricIndex(lines, 4.2), 1);
	assert.equal(activeLyricIndex(lines, 80), 2);
});

test('activeWordIndex follows enhanced LRC word clocks', () => {
	const words = [
		{ time: 12, text: 'You' },
		{ time: 12.4, text: 'can' },
		{ time: 12.8, text: 'take' }
	];
	assert.equal(activeWordIndex(words, 12.39), 0);
	assert.equal(activeWordIndex(words, 12.4), 1);
});

test('lyricsAreSynced requires a timed line', () => {
	assert.equal(lyricsAreSynced([{ time: 0, text: 'unsynced block' }]), false);
	assert.equal(lyricsAreSynced([{ time: 12, text: 'You can take it all' }]), true);
});
