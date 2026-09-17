import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coalesceLyricWords, shouldGlueLyricTokens } from '../src/lib/lyricWords.js';

test('shouldGlueLyricTokens joins apostrophes and contraction tails', () => {
	assert.equal(shouldGlueLyricTokens('don', "'"), true);
	assert.equal(shouldGlueLyricTokens("don'", 't'), true);
	assert.equal(shouldGlueLyricTokens('They', "don't"), false);
	assert.equal(shouldGlueLyricTokens('speak', 'for'), false);
});

test('coalesceLyricWords turns don / \' / t into don\'t', () => {
	const words = coalesceLyricWords([
		{ time: 1, end: 1.2, text: 'They' },
		{ time: 1.22, end: 1.4, text: 'don' },
		{ time: 1.4, end: 1.48, text: "'" },
		{ time: 1.48, end: 1.7, text: 't' }
	]);
	assert.deepEqual(
		words.map((w) => w.text),
		['They', "don't"]
	);
	assert.equal(words[1].end, 1.7);
});

test('coalesceLyricWords keeps a space between real words', () => {
	const words = coalesceLyricWords([
		{ time: 1, text: 'They', breakAfter: true },
		{ time: 1.2, text: "don't" }
	]);
	assert.deepEqual(
		words.map((w) => w.text),
		['They', "don't"]
	);
});

test('coalesceLyricWords glues don / space / apostrophe / space / t', () => {
	const words = coalesceLyricWords([
		{ time: 1, end: 1.2, text: 'don' },
		{ time: 1.2, end: 1.28, text: " '" },
		{ time: 1.28, end: 1.5, text: ' t' }
	]);
	assert.deepEqual(
		words.map((w) => w.text),
		["don't"]
	);
});
