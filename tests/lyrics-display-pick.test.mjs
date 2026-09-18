import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LYRICS_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), 'pick-db-')), 'lyrics.db');

import { pickDisplayLyrics } from '../src/lib/server/hostData.js';

const wordLevel = [
	{ time: 1, text: 'Hello there', words: [{ time: 1, text: 'Hello' }, { time: 1.4, text: 'there' }] }
];
const synthesized = [
	{
		time: 1,
		text: 'Hello there',
		words: [
			{ time: 1, text: 'Hello', estimated: true },
			{ time: 1.4, text: 'there', estimated: true }
		]
	}
];
const modelLines = [
	{ time: 1.02, text: 'Hello there', words: [{ time: 1.02, text: 'Hello', end: 1.31 }, { time: 1.38, text: 'there', end: 1.7 }] }
];

test('a precise on-device alignment beats community word clocks', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: modelLines, engine: 'qwen', precise: true }
	});
	assert.equal(picked.lyrics, modelLines);
	assert.equal(picked.source, 'align:qwen');
});

test('community word clocks beat an energy guess', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'musixmatch' },
		aligned: { lines: modelLines, engine: 'energy', precise: false }
	});
	assert.equal(picked.lyrics, wordLevel);
	assert.equal(picked.source, 'musixmatch');
});

test('an energy guess beats synthesized per-line timing', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: synthesized, wordLevel: false, source: 'lrclib-synced' },
		aligned: { lines: modelLines, engine: 'energy', precise: false }
	});
	assert.equal(picked.lyrics, modelLines);
	assert.equal(picked.source, 'align:energy');
});

test('synthesized timing is shown while nothing better exists, and nothing yields null', () => {
	const only = pickDisplayLyrics({ community: { known: true, lines: synthesized, source: 'lrclib-synced' }, aligned: null });
	assert.equal(only.lyrics, synthesized);
	assert.equal(only.source, 'lrclib-synced');
	assert.deepEqual(pickDisplayLyrics({ community: { known: false, lines: null }, aligned: null }), { lyrics: null, source: null });
	assert.deepEqual(pickDisplayLyrics(), { lyrics: null, source: null });
});

test('a collapsed precise alignment loses to community word clocks', () => {
	const collapsed = [
		{
			time: 1,
			text: 'Hello there',
			words: [
				{ time: 1, text: 'Hello', end: 1 },
				{ time: 1, text: 'there', end: 1 }
			]
		}
	];
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: collapsed, engine: 'qwen', precise: true },
		duration: 200
	});
	assert.equal(picked.lyrics, wordLevel);
	assert.equal(picked.source, 'amll-ttml');
});
