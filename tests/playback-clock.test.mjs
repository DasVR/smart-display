import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	activeLyricIndex,
	activeWordIndex,
	instrumentalDotStates,
	instrumentalDotStatesFromGap,
	instrumentalDotsOpacity,
	instrumentalGap,
	instrumentalRest,
	lineEndClock,
	lineSungThrough,
	isHeldWord,
	isPlaybackJump,
	letterFill,
	letterWave,
	livePlaybackPosition,
	LYRIC_LEAD_SEC,
	lyricsAreSynced,
	MAX_LAST_WORD_SEC,
	singingLyricIndex,
	wordEndTime,
	wordProgress,
	easeToward,
	STACK_EASE_TAU_SEC
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

test('wordEndTime caps an explicit last-word end that runs into the instrumental', () => {
	const words = [
		{ time: 12, text: 'You' },
		{ time: 12.4, text: 'can' },
		{ time: 12.8, end: 40, text: 'take' }
	];
	assert.equal(wordEndTime(words, 2, 40), 12.8 + MAX_LAST_WORD_SEC);
	assert.equal(wordProgress(words, 2, 12.8 + MAX_LAST_WORD_SEC, 40), 1);
	assert.equal(lineSungThrough({ time: 12, text: 'You can take', words, end: 40 }, 14.2), true);
});

test('instrumentalRest starts after the capped last word, not after a far TTML end', () => {
	const lines = [
		{
			time: 12,
			end: 40,
			text: 'take',
			words: [{ time: 12.8, end: 40, text: 'take' }]
		},
		{ time: 40, text: 'next', words: [{ time: 40, end: 40.4, text: 'next' }] }
	];
	const rest = instrumentalRest(lines, 16, 50);
	assert.equal(rest.afterIndex, 0);
	assert.equal(rest.blank, false);
	assert.ok(rest.start < 15, 'dots start once the last syllable ends');
	assert.equal(rest.end, 40);
	assert.equal(singingLyricIndex(lines, 16, 50), -1);
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
	assert.equal(instrumentalGap(lines, 2), null, 'a sung last line is not a blank gap');
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
	// break, well over the 2.5s threshold.
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

test('instrumentalRest shows intro dots before the first lyric line', () => {
	const lines = [
		{
			time: 25.7,
			text: 'a heart that is full up like a landfill',
			words: [{ time: 25.7, end: 26.1, text: 'a' }]
		}
	];
	assert.deepEqual(instrumentalRest(lines, 0), {
		start: 0,
		end: 25.7,
		afterIndex: -1,
		blank: false
	});
	assert.deepEqual(instrumentalRest(lines, 12), {
		start: 0,
		end: 25.7,
		afterIndex: -1,
		blank: false
	});
	assert.equal(instrumentalRest(lines, 25.7), null, 'first word is not an intro rest');
	const mid = instrumentalDotStatesFromGap(instrumentalRest(lines, 12.85), 12.85);
	assert.equal(mid[0], 1);
	assert.ok(Math.abs(mid[1] - 0.5) < 1e-9);
	assert.equal(mid[2], 0);
});

test('instrumentalRest ignores a short wait before the first line', () => {
	const lines = [{ time: 1.2, text: 'hi', words: [{ time: 1.2, end: 1.6, text: 'hi' }] }];
	assert.equal(instrumentalRest(lines, 0.4), null);
});

test('instrumentalRest fills a between-line instrumental with no blank marker', () => {
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
			time: 12,
			text: 'two',
			words: [{ time: 12, end: 12.4, text: 'two' }]
		}
	];
	assert.equal(instrumentalRest(lines, 1.4), null, 'still singing');
	assert.deepEqual(instrumentalRest(lines, 4), {
		start: 1.8,
		end: 12,
		afterIndex: 0,
		blank: false
	});
	assert.equal(singingLyricIndex(lines, 4), -1);
	assert.equal(instrumentalRest(lines, 12), null);
});

test('instrumentalRest prefers a blank LRC marker over a synthetic row', () => {
	const lines = [
		{ time: 1, text: 'verse', words: [{ time: 1, end: 1.5, text: 'verse' }] },
		{ time: 4, text: '' },
		{ time: 20, text: 'chorus' }
	];
	assert.deepEqual(instrumentalRest(lines, 10), {
		start: 4,
		end: 20,
		afterIndex: 1,
		blank: true
	});
});

test('instrumentalRest covers the outro after the last sung line', () => {
	const lines = [
		{
			time: 100,
			text: 'last',
			words: [{ time: 100, end: 101, text: 'last' }]
		}
	];
	assert.deepEqual(instrumentalRest(lines, 110, 180), {
		start: 101,
		end: 180,
		afterIndex: 0,
		blank: false
	});
	assert.equal(instrumentalRest(lines, 100.4, 180), null);
});

test('instrumentalGap treats a trailing blank marker as an outro', () => {
	const lines = [
		{ time: 10, text: 'verse' },
		{ time: 20, text: '' }
	];
	assert.deepEqual(instrumentalGap(lines, 1, 40), { start: 20, end: 40 });
});

test('lineEndClock uses the last word, then line.end, then a short hold', () => {
	assert.equal(
		lineEndClock({
			time: 1,
			text: 'one',
			words: [{ time: 1, end: 1.8, text: 'one' }]
		}),
		1.8
	);
	assert.equal(lineEndClock({ time: 4, end: 6.2, text: 'two' }), 6.2);
	assert.equal(lineEndClock({ time: 8, text: 'three' }), 10.4);
});

test('LYRIC_LEAD_SEC is a hair ahead of the transport clock', () => {
	assert.equal(LYRIC_LEAD_SEC, 0.1);
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

test('isPlaybackJump ignores a metadata restamp of the same sample', () => {
	const prev = { playing: true, position: 10, positionAt: 1_000, length: 200 };
	const lyricsLanded = { ...prev, lyrics: [{ time: 12, text: 'hi' }] };
	assert.equal(isPlaybackJump(prev, lyricsLanded, 5_000), false);
});

test('easeToward closes most of the gap over three time constants', () => {
	let y = 0;
	const target = 100;
	const tau = STACK_EASE_TAU_SEC;
	const dt = 1 / 60;
	for (let t = 0; t < tau * 3; t += dt) {
		y = easeToward(y, target, dt, tau);
	}
	assert.ok(y > 94, `expected ~95 after 3τ, got ${y}`);
	assert.ok(y <= 100);
});

test('easeToward snaps when already close, and when dt is 0', () => {
	assert.equal(easeToward(10, 10.05, 0.016, STACK_EASE_TAU_SEC), 10.05);
	assert.equal(easeToward(0, 40, 0, STACK_EASE_TAU_SEC), 40);
	assert.equal(easeToward(8, 3, 0.016, 0), 3);
});
