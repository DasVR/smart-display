import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	coalesceLyricWords,
	displayLyricWords,
	lineWithCoalescedWords,
	overlayCommunityText,
	shouldGlueLyricTokens
} from '../src/lib/lyricWords.js';

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

test('displayLyricWords fills tokens Qwen dropped and restores line spelling', () => {
	const words = displayLyricWords({
		time: 8,
		text: 'I walk a lonely road',
		words: [
			{ time: 8, text: 'i', end: 8.2 },
			{ time: 8.2, text: 'walk', end: 8.4 },
			{ time: 8.4, text: 'a', end: 8.6 }
		]
	});
	assert.deepEqual(
		words.map((w) => w.text),
		['I', 'walk', 'a', 'lonely', 'road']
	);
	assert.equal(words[0].time, 8);
	assert.equal(words[3].time, 8.6);
});

test('displayLyricWords restores a clipped last word from the fuller line', () => {
	const words = displayLyricWords({
		time: 12,
		text: 'on the boulevard of broken dreams',
		words: [
			{ time: 12, text: 'on', end: 12.2 },
			{ time: 12.2, text: 'the', end: 12.3 },
			{ time: 12.3, text: 'boulevard', end: 12.8 },
			{ time: 12.8, text: 'of', end: 12.9 },
			{ time: 12.9, text: 'broke', end: 13.2 }
		]
	});
	assert.deepEqual(
		words.map((w) => w.text),
		['on', 'the', 'boulevard', 'of', 'broken', 'dreams']
	);
});

test('lineWithCoalescedWords prefers glued contractions over the spaced join', () => {
	const line = lineWithCoalescedWords({
		time: 1,
		text: "don ' t",
		words: [
			{ time: 1, end: 1.2, text: 'don' },
			{ time: 1.2, end: 1.28, text: "'" },
			{ time: 1.28, end: 1.5, text: 't' }
		]
	});
	assert.equal(line.text, "don't");
	assert.equal(line.words.length, 1);
	assert.equal(line.words[0].text, "don't");
});

test('lineWithCoalescedWords keeps a fuller original line Qwen truncated', () => {
	const line = lineWithCoalescedWords({
		time: 8,
		text: 'I walk a lonely road',
		words: [
			{ time: 8, text: 'i', end: 8.2 },
			{ time: 8.2, text: 'walk', end: 8.4 },
			{ time: 8.4, text: 'a', end: 8.6 }
		]
	});
	assert.equal(line.text, 'I walk a lonely road');
	assert.deepEqual(
		line.words.map((w) => w.text),
		['i', 'walk', 'a']
	);
});

test('overlayCommunityText copies the rest of a clipped Qwen line', () => {
	const aligned = [
		{
			time: 8,
			text: 'i walk a',
			words: [
				{ time: 8, text: 'i', end: 8.2 },
				{ time: 8.2, text: 'walk', end: 8.4 },
				{ time: 8.4, text: 'a', end: 8.6 }
			]
		}
	];
	const community = [{ time: 8, text: 'I walk a lonely road' }];
	const out = overlayCommunityText(aligned, community);
	assert.equal(out[0].text, 'I walk a lonely road');
	assert.equal(overlayCommunityText(aligned, [{ time: 8, text: 'i walk a' }]), aligned);
});
