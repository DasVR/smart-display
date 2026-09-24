import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LYRICS_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), 'monitor-db-')), 'lyrics.db');

import { availableLyricProviders, applyLyricAction, getLyricMonitor, providerLabel } from '../src/lib/server/lyricMonitor.js';
import { seedLyricsCache } from '../src/lib/server/lyrics.js';
import { DEMO_TRACK } from '../src/lib/musicDemo.js';

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
	assert.equal(providerLabel('align:wav2vec'), 'Singing CTC');
	assert.equal(providerLabel('genius'), 'Genius');
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

test('availableLyricProviders marks a collapsed Qwen run so it is not treated as precise', () => {
	const collapsed = [
		{
			time: 0.2,
			text: 'i walk a lonely road the only one',
			words: 'i walk a lonely road the only one'.split(' ').map((text) => ({
				time: 0.2,
				text,
				end: 0.2
			}))
		}
	];
	const providers = availableLyricProviders({
		community: { lines: communityLines, wordLevel: true, source: 'amll-ttml' },
		aligned: { lines: collapsed, engine: 'qwen', precise: true }
	});
	const qwen = providers.find((p) => p.id === 'align:qwen');
	assert.equal(qwen.collapsed, true);
	assert.equal(qwen.precise, false);
	assert.equal(providers[0].id, 'amll-ttml');
});

test('availableLyricProviders does not double-list Qwen copied into the lyrics cache', () => {
	const providers = availableLyricProviders({
		community: { lines: alignedLines, source: 'align:qwen', wordLevel: true },
		aligned: { lines: alignedLines, engine: 'qwen', precise: true }
	});
	assert.equal(providers.length, 1);
	assert.equal(providers[0].id, 'align:qwen');
});

function seedDemoLyrics() {
	seedLyricsCache(DEMO_TRACK.artist, DEMO_TRACK.title, {
		album: DEMO_TRACK.album,
		duration: DEMO_TRACK.length,
		source: 'kugou-krc',
		lines: communityLines
	});
}

test('getLyricMonitor demo mode uses the No Surprises preview track', async () => {
	seedDemoLyrics();
	const data = await getLyricMonitor({ demo: true });
	assert.equal(data.track.title, 'No Surprises');
	assert.equal(data.track.artist, 'Radiohead');
	assert.ok(Array.isArray(data.providers));
	assert.ok(data.engine?.engine);
	assert.ok('canonical' in data);
});

test('applyLyricAction demo pin keeps the demo track in the reply', async () => {
	seedDemoLyrics();
	const live = await getLyricMonitor({ demo: true });
	const source = live.providers[0]?.id;
	assert.ok(source, 'demo lyrics are seeded');
	const pinned = await applyLyricAction({ action: 'pin', source, demo: true });
	assert.equal(pinned.track.title, 'No Surprises');
	assert.equal(pinned.displaySource, source);
	assert.equal(pinned.pick?.pinned, true);
	await applyLyricAction({ action: 'unpin', demo: true });
});
