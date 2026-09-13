import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	activeLyricIndex,
	activeWordIndex,
	instrumentalDotsOpacity,
	instrumentalGap,
	livePlaybackPosition,
	lyricsAreSynced,
	wordProgress
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

test('wordProgress sweeps left-to-right across a word span', () => {
	const words = [
		{ time: 12, text: 'You' },
		{ time: 12.4, text: 'can' },
		{ time: 12.8, text: 'take' }
	];
	assert.equal(wordProgress(words, 0, 12, 13.4), 0);
	assert.ok(Math.abs(wordProgress(words, 0, 12.2, 13.4) - 0.5) < 1e-9);
	assert.equal(wordProgress(words, 0, 12.4, 13.4), 1);
	// Last word falls back to the next line's start as its end boundary.
	assert.ok(Math.abs(wordProgress(words, 2, 13.1, 13.4) - 0.5) < 1e-9);
});

test('wordProgress clamps to 0..1 outside the word span', () => {
	const words = [{ time: 10, text: 'hi' }];
	assert.equal(wordProgress(words, 0, 9, 10.6), 0);
	assert.equal(wordProgress(words, 0, 99, 10.6), 1);
});

test('instrumentalGap only fires on a blank line with a long rest after it', () => {
	const lines = [
		{ time: 0, text: 'intro' },
		{ time: 4, text: '' },
		{ time: 20, text: 'verse' }
	];
	assert.deepEqual(instrumentalGap(lines, 1), { start: 4, end: 20 });
	assert.equal(instrumentalGap(lines, 0), null, 'a real lyric line never becomes dots');
	assert.equal(instrumentalGap(lines, 2), null, 'no next line to measure the gap against');
});

test('instrumentalGap ignores a short blank line (just a breath, not a break)', () => {
	const lines = [
		{ time: 0, text: '' },
		{ time: 2, text: 'verse' }
	];
	assert.equal(instrumentalGap(lines, 0), null);
});

test('instrumentalDotsOpacity rises across the gap and caps at 1', () => {
	const lines = [
		{ time: 0, text: 'intro' },
		{ time: 4, text: '' },
		{ time: 20, text: 'verse' }
	];
	assert.equal(instrumentalDotsOpacity(lines, 1, 4), 0);
	assert.equal(instrumentalDotsOpacity(lines, 1, 12), 0.5);
	assert.equal(instrumentalDotsOpacity(lines, 1, 20), 1);
	assert.equal(instrumentalDotsOpacity(lines, 1, 25), 1);
	assert.equal(instrumentalDotsOpacity(lines, 0, 1), 0, 'a real lyric line never shows dots');
});
