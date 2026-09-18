import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	closeLyricsDb,
	getAlignmentRow,
	getLyricsRow,
	getRecordingRow,
	listLyricsForAlign,
	lyricsDbAvailable,
	lyricsDbPath,
	lyricsDbStats,
	putAlignmentRow,
	putLyricsRow,
	putRecordingRow
} from '../src/lib/server/lyricsStore.js';

function freshDb() {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'lyrics-store-'));
	process.env.LYRICS_DB_PATH = path.join(dir, 'lyrics.db');
	closeLyricsDb();
	return dir;
}

test('node:sqlite is available on this Node', () => {
	assert.equal(lyricsDbAvailable(), true);
});

test('lyrics rows round-trip with provenance and honor their ttl', () => {
	freshDb();
	const lines = [{ time: 1, text: 'Hello there', words: [{ time: 1, text: 'Hello' }, { time: 1.4, text: 'there' }] }];
	assert.equal(
		putLyricsRow('a|b||200', {
			artist: 'A',
			title: 'B',
			album: '',
			duration: 200,
			source: 'amll-ttml',
			wordLevel: true,
			lines,
			plainText: 'Hello there',
			fetchedAt: Date.now(),
			ttl: 60_000
		}),
		true
	);
	const row = getLyricsRow('a|b||200');
	assert.equal(row.source, 'amll-ttml');
	assert.equal(row.wordLevel, true);
	assert.deepEqual(row.lines, lines);
	assert.equal(row.plainText, 'Hello there');
	assert.equal(row.duration, 200);

	putLyricsRow('stale', {
		artist: 'A',
		title: 'Old',
		lines,
		fetchedAt: Date.now() - 10_000,
		ttl: 1_000
	});
	assert.equal(getLyricsRow('stale'), null, 'expired rows read as absent');
	assert.equal(getLyricsRow('never'), null);
	assert.ok(existsSync(lyricsDbPath()));
});

test('rows survive a close and reopen of the same file', () => {
	freshDb();
	putLyricsRow('k', { artist: 'A', title: 'B', lines: [{ time: 0, text: 'x y' }], fetchedAt: Date.now(), ttl: 60_000 });
	putAlignmentRow('fp1', {
		artist: 'A',
		title: 'B',
		duration: 200,
		engine: 'qwen',
		precise: true,
		lines: [{ time: 0.5, text: 'x y', words: [{ time: 0.5, text: 'x', end: 0.7 }, { time: 0.8, text: 'y', end: 1.0 }] }]
	});
	closeLyricsDb();
	assert.equal(getLyricsRow('k').lines[0].text, 'x y');
	const aligned = getAlignmentRow('fp1');
	assert.equal(aligned.engine, 'qwen');
	assert.equal(aligned.precise, true);
	assert.equal(aligned.lines[0].words[1].end, 1.0);
	const stats = lyricsDbStats();
	assert.equal(stats.lyrics, 1);
	assert.equal(stats.alignments, 1);
	assert.equal(stats.precise, 1);
});

test('putAlignmentRow replaces an energy result with a later precise one', () => {
	freshDb();
	putAlignmentRow('fp2', { engine: 'energy', precise: false, lines: [{ time: 0, text: 'a b' }] });
	assert.equal(getAlignmentRow('fp2').precise, false);
	putAlignmentRow('fp2', { engine: 'ctc', precise: true, lines: [{ time: 0.2, text: 'a b' }] });
	const row = getAlignmentRow('fp2');
	assert.equal(row.engine, 'ctc');
	assert.equal(row.precise, true);
	assert.equal(row.lines[0].time, 0.2);
	assert.equal(putAlignmentRow('fp3', { engine: 'ctc', lines: [] }), false, 'an empty result is not stored');
});

test('legacy forced-align-cache json files are imported once on open', () => {
	const dir = freshDb();
	const legacyDir = path.join(dir, 'legacy');
	mkdirSync(legacyDir, { recursive: true });
	writeFileSync(path.join(legacyDir, 'abc123.json'), JSON.stringify({ engine: 'energy', lines: [{ time: 1, text: 'old' }] }));
	writeFileSync(path.join(legacyDir, 'broken.json'), '{not json');
	process.env.FORCED_ALIGN_CACHE_DIR = legacyDir;
	try {
		const row = getAlignmentRow('abc123');
		assert.ok(row, 'legacy file should be visible as a row');
		assert.equal(row.engine, 'energy');
		assert.equal(row.precise, false);
		assert.equal(getAlignmentRow('broken'), null);
	} finally {
		delete process.env.FORCED_ALIGN_CACHE_DIR;
	}
});

test('recordings and lyrics-for-align lists round-trip', () => {
	freshDb();
	putLyricsRow('k1', {
		artist: 'A',
		title: 'Has Text',
		duration: 200,
		plainText: 'hello there',
		lines: [{ time: 1, text: 'hello there' }],
		fetchedAt: Date.now(),
		ttl: 60_000
	});
	putLyricsRow('k2', {
		artist: 'A',
		title: 'Empty',
		duration: 200,
		plainText: '',
		lines: [{ time: 1, text: 'x' }],
		fetchedAt: Date.now(),
		ttl: 60_000
	});
	assert.equal(listLyricsForAlign().length, 1);
	assert.equal(listLyricsForAlign()[0].title, 'Has Text');
	assert.equal(putRecordingRow('fp-rec', { path: '/tmp/x.wav', offsetSec: 1.5, durationSec: 200 }), true);
	const rec = getRecordingRow('fp-rec');
	assert.equal(rec.path, '/tmp/x.wav');
	assert.equal(rec.offsetSec, 1.5);
	assert.equal(lyricsDbStats().recordings, 1);
});
