import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorAlignedLines, lyricOffset, matchLyricLines, reconcileLyricOffset } from '../src/lib/lyricAnchor.js';

const ref = [
	{ time: 10, text: 'One two three' },
	{ time: 14, text: '' },
	{ time: 20, text: 'Four five six' },
	{ time: 25, text: 'Seven eight' },
	{ time: 30, text: 'Nine ten' },
	{ time: 35, text: 'Eleven twelve' }
];

function karaoke(offset) {
	return ref
		.filter((l) => l.text)
		.map((l) => ({
			time: l.time + offset,
			end: l.time + offset + 1,
			text: l.text,
			words: l.text.split(' ').map((w, i) => ({ time: l.time + offset + i * 0.3, text: w, end: l.time + offset + i * 0.3 + 0.25 }))
		}));
}

test('matchLyricLines pairs lines by letters in order and skips blanks', () => {
	const pairs = matchLyricLines(karaoke(0), ref);
	assert.deepEqual(pairs, [
		[0, 0],
		[1, 2],
		[2, 3],
		[3, 4],
		[4, 5]
	]);
});

test('reconcileLyricOffset shifts a file from another release onto this one', () => {
	const shifted = reconcileLyricOffset(karaoke(3.2), ref);
	assert.ok(Math.abs(shifted[0].time - 10) < 1e-9);
	assert.ok(Math.abs(shifted[0].words[1].time - 10.3) < 1e-9);
	assert.ok(Math.abs(shifted[0].end - 11) < 1e-9);
	assert.ok(Math.abs(lyricOffset(shifted, ref).offset) < 1e-9);
});

test('reconcileLyricOffset leaves an agreeing or structurally different file alone', () => {
	const close = karaoke(0.1);
	assert.equal(reconcileLyricOffset(close, ref), close);
	const messy = karaoke(0).map((l, i) => ({ ...l, time: l.time + [0, 5, -4, 9, 2][i] }));
	assert.equal(reconcileLyricOffset(messy, ref), messy);
	const few = karaoke(5).slice(0, 2);
	assert.equal(reconcileLyricOffset(few, ref), few, 'too few matched lines to trust');
});

test('anchorAlignedLines squeezes a moved line so it ends before the next stamp', () => {
	const aligned = [{ time: 12, text: 'Four five six', words: [{ time: 12, text: 'Four', end: 13 }, { time: 13, text: 'five', end: 15 }, { time: 15, text: 'six', end: 30 }] }];
	const [moved] = anchorAlignedLines(aligned, ref);
	assert.equal(moved.time, 20);
	assert.ok(moved.words[2].end <= 25 + 1e-9);
	assert.ok(moved.words[0].time === 20);
});
