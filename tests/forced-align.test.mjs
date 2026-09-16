import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	ensureAlignedLyrics,
	isAlignmentInFlight,
	readCachedAlignment,
	trackFingerprint
} from '../src/lib/server/forcedAlign.js';

function fakeChild({ exitCode = 0, stderr = '' } = {}) {
	const proc = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = () => proc.emit('exit', 0);
	queueMicrotask(() => {
		if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
		proc.emit('exit', exitCode);
	});
	return proc;
}

test('trackFingerprint is stable for the same artist/title/duration and ignores case', () => {
	const a = trackFingerprint('Limp Bizkit', 'My Way', 273);
	const b = trackFingerprint('limp bizkit', 'my way', 273.4);
	const c = trackFingerprint('Limp Bizkit', 'My Way', 200);
	assert.equal(a, b);
	assert.notEqual(a, c);
});

test('readCachedAlignment returns null when nothing is cached', () => {
	process.env.FORCED_ALIGN_CACHE_DIR = mkdtempSync(path.join(os.tmpdir(), 'align-cache-'));
	assert.equal(readCachedAlignment('does-not-exist'), null);
});

test('ensureAlignedLyrics no-ops without plain lyrics, without a usable duration, or when joined late', () => {
	assert.equal(ensureAlignedLyrics({ artist: 'A', title: 'B', duration: 200, plainLyrics: null }), null);
	assert.equal(ensureAlignedLyrics({ artist: 'A', title: 'B', duration: 0, plainLyrics: 'hi' }), null);
	assert.equal(ensureAlignedLyrics({ artist: 'A', title: 'B', duration: 5, plainLyrics: 'hi' }), null);
	assert.equal(
		ensureAlignedLyrics({ artist: 'A', title: 'B', duration: 200, plainLyrics: 'hi', position: 30 }),
		null
	);
});

test('ensureAlignedLyrics records, aligns, and caches when joined near the start of a valid track', async () => {
	const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'align-cache-'));
	process.env.FORCED_ALIGN_CACHE_DIR = cacheDir;
	const calls = [];
	const fp = ensureAlignedLyrics({
		artist: 'Test Artist',
		title: 'Test Song',
		duration: 200,
		plainLyrics: 'line one\nline two',
		position: 1,
		spawnFn: (bin, args) => {
			calls.push([bin, args]);
			if (bin === 'parec') {
				// The real parec writes the WAV as it records; ensureAlignedLyrics
				// checks the file exists before moving on to alignment.
				const outPath = args[args.length - 1];
				mkdirSync(path.dirname(outPath), { recursive: true });
				writeFileSync(outPath, 'fake wav bytes');
			}
			if (bin === 'python3') {
				// Simulate align.py writing the cache file itself, same as the
				// real script does (atomic write via .tmp + rename).
				const outPath = args[args.length - 1];
				mkdirSync(path.dirname(outPath), { recursive: true });
				writeFileSync(outPath, JSON.stringify({ lines: [{ time: 0.5, text: 'line one' }] }));
			}
			return fakeChild();
		},
		findBinary: () => '/usr/bin/parec'
	});
	assert.ok(fp);
	assert.equal(isAlignmentInFlight(fp), true);

	// Wait for the fire-and-forget job chain (record -> align -> cache write)
	// to settle; both legs resolve on microtasks/fakeChild's queueMicrotask.
	await new Promise((resolve) => setTimeout(resolve, 20));

	assert.equal(isAlignmentInFlight(fp), false);
	assert.equal(calls[0][0], 'parec');
	assert.equal(calls[1][0], 'python3');
	const cached = readCachedAlignment(fp);
	assert.ok(cached);
	assert.equal(cached[0].text, 'line one');
});

test('ensureAlignedLyrics returns the same fingerprint without starting a second job while one is in flight', () => {
	process.env.FORCED_ALIGN_CACHE_DIR = mkdtempSync(path.join(os.tmpdir(), 'align-cache-'));
	const calls = [];
	const opts = {
		artist: 'Slow Artist',
		title: 'Slow Song',
		duration: 200,
		plainLyrics: 'la la la',
		position: 0,
		spawnFn: (bin, args) => {
			calls.push(bin);
			// Never settles within this test, so the job stays "in flight".
			return new EventEmitter();
		},
		findBinary: () => '/usr/bin/parec'
	};
	const first = ensureAlignedLyrics(opts);
	const second = ensureAlignedLyrics(opts);
	assert.equal(first, second);
	assert.equal(calls.length, 1, 'a second call while in flight should not spawn another recorder');
});

test('ensureAlignedLyrics skips work entirely once a result is already cached', () => {
	const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'align-cache-'));
	process.env.FORCED_ALIGN_CACHE_DIR = cacheDir;
	const fp = trackFingerprint('Cached Artist', 'Cached Song', 200);
	writeFileSync(path.join(cacheDir, `${fp}.json`), JSON.stringify({ lines: [{ time: 0, text: 'hi' }] }));

	const calls = [];
	const result = ensureAlignedLyrics({
		artist: 'Cached Artist',
		title: 'Cached Song',
		duration: 200,
		plainLyrics: 'hi',
		position: 0,
		spawnFn: (bin) => {
			calls.push(bin);
			return fakeChild();
		}
	});
	assert.equal(result, fp);
	assert.equal(calls.length, 0, 'should never spawn a recorder for an already-cached track');
});
