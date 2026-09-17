import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	activeLyricIndex,
	activeWordIndex,
	instrumentalDotStates,
	instrumentalDotsOpacity,
	instrumentalGap,
	lineSungThrough,
	isHeldWord,
	isPlaybackJump,
	letterFill,
	letterWave,
	livePlaybackPosition,
	lyricsAreSynced,
	singingLyricIndex,
	wordEndTime,
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

test('livePlaybackPosition freezes at the last sample while seeking, instead of extrapolating off a stale one', () => {
	const track = { playing: true, position: 10, positionAt: 1_000, length: 200, seeking: true };
	// Without the seeking flag this would extrapolate to 12 (2s elapsed);
	// mid-seek, `position` is about to go stale, so it should hold still.
	assert.equal(livePlaybackPosition(track, 3_000), 10);
	assert.equal(livePlaybackPosition({ ...track, seeking: false }, 3_000), 12);
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
	// Last word with a nearby next-line clock still uses that tight bound.
	assert.ok(Math.abs(wordProgress(words, 2, 13.1, 13.4) - 0.5) < 1e-9);
});

test('wordProgress finishes a last word at its own end instead of the next line', () => {
	const words = [
		{ time: 12, text: 'You' },
		{ time: 12.4, text: 'can' },
		{ time: 12.8, end: 13.1, text: 'take' }
	];
	assert.ok(Math.abs(wordProgress(words, 2, 12.95, 40) - 0.5) < 1e-9);
	assert.equal(wordProgress(words, 2, 13.1, 40), 1);
	assert.equal(wordProgress(words, 2, 20, 40), 1);
});

test('wordProgress does not stretch the last word across a long instrumental', () => {
	const words = [
		{ time: 12, text: 'You' },
		{ time: 12.4, text: 'can' },
		{ time: 12.8, text: 'take' }
	];
	// No end clock, next line at 40s. Last word should finish ~0.6s after it starts.
	assert.equal(wordEndTime(words, 2, 40), 13.4);
	assert.equal(wordProgress(words, 2, 13.4, 40), 1);
	assert.equal(wordProgress(words, 2, 20, 40), 1);
});

test('singingLyricIndex goes dark after the last word and stays dark until the next line', () => {
	const lines = [
		{
			time: 1,
			text: 'one line',
			words: [
				{ time: 1, end: 1.3, text: 'one' },
				{ time: 1.3, end: 1.8, text: 'line' }
			]
		},
		{
			time: 8,
			text: 'two',
			words: [{ time: 8, end: 8.4, text: 'two' }]
		}
	];
	assert.equal(singingLyricIndex(lines, 0), -1);
	assert.equal(singingLyricIndex(lines, 1.1), 0);
	assert.equal(singingLyricIndex(lines, 1.8), -1);
	assert.equal(activeLyricIndex(lines, 1.8), 0, 'started index stays on the finished line');
	assert.equal(lineSungThrough(lines[0], 1.8), true);
	assert.equal(singingLyricIndex(lines, 5), -1);
	assert.equal(singingLyricIndex(lines, 8.1), 1);
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

test('instrumentalDotStates lights up one dot at a time in sequence', () => {
	// Gap: line 1 (blank, time 0) -> line 2 (time 18) = an 18s instrumental
	// break, well over the 5s threshold.
	const lines = [
		{ time: -2, text: 'intro' },
		{ time: 0, text: '' },
		{ time: 18, text: 'verse' }
	];

	assert.deepEqual(instrumentalDotStates(lines, 1, 0), [0, 0, 0]);
	// A third of the way through: only the first dot is lit.
	const third = instrumentalDotStates(lines, 1, 6);
	assert.equal(third[0], 1);
	assert.equal(third[1], 0);
	assert.equal(third[2], 0);
	// Halfway through the second dot's segment (segment 2 spans 6s-12s).
	const mid = instrumentalDotStates(lines, 1, 9);
	assert.equal(mid[0], 1);
	assert.ok(Math.abs(mid[1] - 0.5) < 1e-9);
	assert.equal(mid[2], 0);
	assert.deepEqual(instrumentalDotStates(lines, 1, 18), [1, 1, 1]);
});

test('instrumentalDotStates returns all-zero dots outside a real gap', () => {
	const lines = [
		{ time: 0, text: 'intro' },
		{ time: 4, text: 'verse' }
	];
	assert.deepEqual(instrumentalDotStates(lines, 0, 2), [0, 0, 0]);
});

test('isHeldWord is true only for words sung longer than a spoken syllable', () => {
	assert.equal(isHeldWord([{ time: 0, end: 0.4, text: 'a' }], 0), false);
	assert.equal(isHeldWord([{ time: 0, end: 1.2, text: 'you' }], 0), true);
});

test('letterFill lights letters in sequence across a held word', () => {
	assert.equal(letterFill(0, 0, 4), 0);
	assert.equal(letterFill(1, 0, 4), 1);
	assert.ok(letterFill(0.2, 0, 4) > 0);
	assert.equal(letterFill(0.2, 3, 4), 0);
	assert.ok(letterFill(1, 3, 4) > 0.9);
});

test('letterWave peaks mid-letter and is 0 at the ends', () => {
	assert.equal(letterWave(0), 0);
	assert.ok(Math.abs(letterWave(1)) < 1e-9);
	assert.ok(letterWave(0.5) > 0.99);
});

test('isPlaybackJump detects a scrub, not the next extrapolated frame', () => {
	const prev = { playing: true, position: 10, positionAt: 1_000, length: 200 };
	assert.equal(isPlaybackJump(prev, { playing: true, position: 11, positionAt: 2_000, length: 200 }, 2_000), false);
	assert.equal(isPlaybackJump(prev, { playing: true, position: 40, positionAt: 2_000, length: 200 }, 2_000), true);
	assert.equal(isPlaybackJump(prev, { playing: true, position: 10, positionAt: 1_000, seeking: true }, 2_000), true);
});
