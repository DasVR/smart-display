import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LYRICS_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), 'pick-db-')), 'lyrics.db');

import { pickDisplayLyrics } from '../src/lib/server/hostData.js';
import { isCollapsedAlignment } from '../src/lib/server/lyrics.js';

function collapsedVerse(text = 'i walk a lonely road the only one') {
	const tokens = text.split(' ');
	return [
		{
			time: 0.2,
			text,
			words: tokens.map((word) => ({ time: 0.2, text: word, end: 0.2 }))
		}
	];
}

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

test('human-stamped community word clocks beat a precise on-device alignment', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: modelLines, engine: 'qwen', precise: true }
	});
	assert.equal(picked.lyrics, wordLevel);
	assert.equal(picked.source, 'amll-ttml');
});

test('a precise alignment beats synthesized per-line timing', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: synthesized, wordLevel: false, source: 'lrclib-synced' },
		aligned: { lines: modelLines, engine: 'wav2vec', precise: true }
	});
	assert.equal(picked.lyrics[0].words[0].time, 1.02);
	assert.equal(picked.source, 'align:wav2vec');
});

test('an aligned line that wandered off is pulled back onto the human line stamp', () => {
	const human = [
		{ time: 10, text: 'First line here' },
		{ time: 20, text: 'Second line here' },
		{ time: 30, text: 'Third line here' }
	];
	const words = (t, text) => text.split(' ').map((w, i) => ({ time: t + i * 0.4, text: w, end: t + i * 0.4 + 0.35 }));
	const lost = [
		{ time: 10.1, text: 'First line here', words: words(10.1, 'First line here') },
		{ time: 26, text: 'Second line here', words: words(26, 'Second line here') },
		{ time: 30.2, text: 'Third line here', words: words(30.2, 'Third line here') }
	];
	const picked = pickDisplayLyrics({
		community: { known: true, lines: human, wordLevel: false, source: 'lrclib-synced' },
		aligned: { lines: lost, engine: 'wav2vec', precise: true }
	});
	assert.equal(picked.lyrics[0].time, 10.1, 'a line within tolerance keeps the model clock');
	assert.equal(picked.lyrics[1].time, 20, 'a drifted line snaps to the human stamp');
	assert.ok(Math.abs(picked.lyrics[1].words[1].time - 20.4) < 1e-9, 'word spacing moves with it');
	assert.equal(picked.lyrics[2].time, 30.2);
});

test('masked swears on an alignment are restored from the lyric sheet', () => {
	const picked = pickDisplayLyrics({
		community: { known: false, lines: null, plainText: 'I said fuck you' },
		aligned: {
			lines: [{ time: 1, text: 'I said f**k you', words: [{ time: 1, text: 'I' }, { time: 1.2, text: 'said' }, { time: 1.4, text: 'f**k' }, { time: 1.7, text: 'you' }] }],
			engine: 'wav2vec',
			precise: true
		}
	});
	assert.equal(picked.lyrics[0].text, 'I said fuck you');
	assert.equal(picked.lyrics[0].words[2].text, 'fuck');
});

test('community word clocks beat an energy guess', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'musixmatch' },
		aligned: { lines: modelLines, engine: 'energy', precise: false }
	});
	assert.equal(picked.lyrics, wordLevel);
	assert.equal(picked.source, 'musixmatch');
});

test('human line stamps beat an energy guess', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: synthesized, wordLevel: false, source: 'lrclib-synced' },
		aligned: { lines: modelLines, engine: 'energy', precise: false }
	});
	assert.equal(picked.lyrics, synthesized);
	assert.equal(picked.source, 'lrclib-synced');
});

test('an energy guess beats unsynced plain lyrics', () => {
	const plain = [{ time: 0, text: 'Hello there' }];
	const picked = pickDisplayLyrics({
		community: { known: true, lines: plain, wordLevel: false, source: 'lrclib-plain' },
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

test('an alignment without usable word clocks never replaces community lines', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: synthesized, source: 'lrclib-plain' },
		aligned: { lines: [{ time: 0, text: 'Hello there' }], engine: 'qwen', precise: true }
	});
	assert.equal(picked.lyrics, synthesized);
});

test('a remote pick of community beats a precise Qwen alignment', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: modelLines, engine: 'qwen', precise: true },
		pick: { displaySource: 'amll-ttml' }
	});
	assert.equal(picked.lyrics, wordLevel);
	assert.equal(picked.source, 'amll-ttml');
});

test('a remote pick of Qwen still uses the alignment when asked', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: modelLines, engine: 'qwen', precise: true },
		pick: { displaySource: 'align:qwen' }
	});
	assert.equal(picked.lyrics, modelLines);
	assert.equal(picked.source, 'align:qwen');
});

test('isCollapsedAlignment flags a verse stamped onto one clock', () => {
	assert.equal(isCollapsedAlignment(collapsedVerse()), true);
	assert.equal(isCollapsedAlignment(modelLines), false);
	assert.equal(isCollapsedAlignment(wordLevel), false);
});

test('community word clocks beat a collapsed Qwen alignment', () => {
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: collapsedVerse(), engine: 'qwen', precise: true }
	});
	assert.equal(picked.lyrics, wordLevel);
	assert.equal(picked.source, 'amll-ttml');
});

test('a remote pick of collapsed Qwen still uses the alignment when asked', () => {
	const collapsed = collapsedVerse();
	const picked = pickDisplayLyrics({
		community: { known: true, lines: wordLevel, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: collapsed, engine: 'qwen', precise: true },
		pick: { displaySource: 'align:qwen' }
	});
	assert.equal(picked.source, 'align:qwen');
	assert.equal(picked.lyrics[0].text, collapsed[0].text);
});

test('collapsed Qwen is still shown when nothing else exists', () => {
	const collapsed = collapsedVerse();
	const picked = pickDisplayLyrics({
		community: { known: false, lines: null },
		aligned: { lines: collapsed, engine: 'qwen', precise: true }
	});
	assert.equal(picked.source, 'align:qwen');
	assert.equal(picked.lyrics[0].text, collapsed[0].text);
});

test('a clipped Qwen line is filled from the community text while staying the align source', () => {
	const clipped = [
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
	const communityLines = [{ time: 8, text: 'I walk a lonely road' }];
	const picked = pickDisplayLyrics({
		community: { known: true, lines: communityLines, wordLevel: false, source: 'lrclib-synced' },
		aligned: { lines: clipped, engine: 'qwen', precise: true }
	});
	assert.equal(picked.source, 'align:qwen');
	assert.equal(picked.lyrics[0].text, 'I walk a lonely road');
	assert.equal(picked.lyrics[0].words.length, 3);
});
