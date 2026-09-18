import { test } from 'node:test';
import assert from 'node:assert/strict';

import { availableLyricProviders, providerLabel } from '../src/lib/server/lyricMonitor.js';

const communityLines = [
	{
		time: 8,
		text: 'I walk a lonely road',
		words: [
			{ time: 8, text: 'I', end: 8.3 },
			{ time: 8.3, text: 'walk', end: 8.6 }
		]
	}
];
const alignedLines = [
	{
		time: 8.02,
		text: 'I walk a lonely road',
		words: [
			{ time: 8.02, text: 'I', end: 8.28 },
			{ time: 8.28, text: 'walk', end: 8.51 },
			{ time: 8.51, text: 'a', end: 8.62 },
			{ time: 8.62, text: 'lonely', end: 8.9 },
			{ time: 8.9, text: 'road', end: 9.2 }
		]
	}
];

test('providerLabel names community and Qwen sources', () => {
	assert.equal(providerLabel('amll-ttml'), 'AMLL TTML');
	assert.equal(providerLabel('align:qwen'), 'Qwen aligner');
	assert.equal(providerLabel('align:energy'), 'Energy guess');
});

test('availableLyricProviders lists community and Qwen as separate switches', () => {
	const providers = availableLyricProviders({
		community: { lines: communityLines, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: alignedLines, engine: 'qwen', precise: true }
	});
	assert.deepEqual(
		providers.map((p) => p.id),
		['amll-ttml', 'align:qwen']
	);
	assert.equal(providers[0].kind, 'community');
	assert.equal(providers[1].kind, 'align');
	assert.equal(providers[1].precise, true);
	assert.equal(providers[1].lines[0].wordCount, 5);
	assert.equal(providers[1].lines[0].words[4].text, 'road');
});

test('availableLyricProviders does not double-list Qwen copied into the lyrics cache', () => {
	const providers = availableLyricProviders({
		community: { lines: alignedLines, source: 'align:qwen', wordLevel: true },
		aligned: { lines: alignedLines, engine: 'qwen', precise: true }
	});
	assert.equal(providers.length, 1);
	assert.equal(providers[0].id, 'align:qwen');
});
