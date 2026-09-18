import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LYRICS_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), 'align-db-')), 'lyrics.db');
process.env.FORCED_ALIGN_AUDIO_DIR = mkdtempSync(path.join(os.tmpdir(), 'align-wav-'));

import {
	alignEngineInfo,
	alignmentQuality,
	cancelOtherAlignments,
	ensureAlignedLyrics,
	isAlignmentInFlight,
	isBetterAlignment,
	probeAlignEngine,
	readCachedAlignment,
	readCachedAlignmentInfo,
	resetAlignEngineProbe,
	shouldAlign,
	sweepCachedLyrics,
	trackFingerprint
} from '../src/lib/server/forcedAlign.js';
import { getAlignmentRow, putLyricsRow, putRecordingRow } from '../src/lib/server/lyricsStore.js';

const ENERGY = { engine: 'energy', precise: false, available: ['energy'] };
const QWEN = { engine: 'qwen', precise: true, available: ['qwen', 'energy'] };

function fakeProbeChild(stdout) {
	const proc = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.kill = () => proc.emit('close', null);
	queueMicrotask(() => {
		if (stdout != null) proc.stdout.emit('data', Buffer.from(stdout));
		proc.emit('close', 0);
	});
	return proc;
}

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
	await new Promise((resolve) => setTimeout(resolve, 50));

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

test('cancelOtherAlignments stops a recording that is not the current track', () => {
	process.env.FORCED_ALIGN_CACHE_DIR = mkdtempSync(path.join(os.tmpdir(), 'align-cache-'));
	const killed = [];
	const hanging = new EventEmitter();
	hanging.kill = (sig) => killed.push(sig);
	ensureAlignedLyrics({
		artist: 'Old Artist',
		title: 'Old Song',
		duration: 200,
		plainLyrics: 'la la',
		position: 0,
		spawnFn: () => hanging,
		findBinary: () => '/usr/bin/parec'
	});
	const keep = trackFingerprint('New Artist', 'New Song', 200);
	cancelOtherAlignments(keep);
	assert.equal(killed[0], 'SIGTERM');
});

test('shouldAlign: a precise engine aligns every track until a precise result exists', () => {
	assert.equal(shouldAlign({ cached: null, engine: QWEN, communityWordLevel: true }), true);
	assert.equal(shouldAlign({ cached: null, engine: QWEN, communityWordLevel: false }), true);
	assert.equal(
		shouldAlign({ cached: { engine: 'energy', precise: false }, engine: QWEN, communityWordLevel: true }),
		true,
		'an energy guess gets upgraded once a real aligner is installed'
	);
	assert.equal(shouldAlign({ cached: { engine: 'qwen', precise: true }, engine: QWEN }), false);
	assert.equal(shouldAlign({ cached: { engine: 'ctc', precise: true }, engine: ENERGY }), false);
	assert.equal(
		shouldAlign({ cached: { engine: 'ctc', precise: true }, engine: QWEN }),
		true,
		'a better engine redoes an older precise result from the saved WAV'
	);
});

test('shouldAlign: the energy stand-in only fills gaps and never redoes itself', () => {
	assert.equal(shouldAlign({ cached: null, engine: ENERGY, communityWordLevel: false }), true);
	assert.equal(shouldAlign({ cached: null, engine: ENERGY, communityWordLevel: true }), false);
	assert.equal(shouldAlign({ cached: { engine: 'energy', precise: false }, engine: ENERGY }), false);
	assert.equal(shouldAlign({ cached: null, engine: null, communityWordLevel: true }), false, 'unknown engine = energy');
	assert.equal(shouldAlign({ cached: null, engine: null, communityWordLevel: false }), true);
});

test('probeAlignEngine parses align.py --probe and exposes it synchronously afterwards', async () => {
	resetAlignEngineProbe();
	delete process.env.FORCED_ALIGN_ENGINE;
	assert.equal(alignEngineInfo(), null);
	const args = [];
	const info = await probeAlignEngine({
		spawnFn: (bin, a) => {
			args.push([bin, a]);
			return fakeProbeChild(JSON.stringify({ engine: 'qwen', precise: true, available: ['qwen', 'ctc', 'energy'] }));
		}
	});
	assert.equal(info.engine, 'qwen');
	assert.equal(info.precise, true);
	assert.deepEqual(info.available, ['qwen', 'ctc', 'energy']);
	assert.ok(args[0][1][0].endsWith('align.py'));
	assert.equal(args[0][1][1], '--probe');
	assert.equal(alignEngineInfo().engine, 'qwen');
	const again = await probeAlignEngine({ spawnFn: () => assert.fail('probe should only spawn once') });
	assert.equal(again.engine, 'qwen');
	resetAlignEngineProbe();
});

test('probeAlignEngine falls back to energy on garbage output and honors FORCED_ALIGN_ENGINE', async () => {
	resetAlignEngineProbe();
	const info = await probeAlignEngine({ spawnFn: () => fakeProbeChild('not json') });
	assert.equal(info.engine, 'energy');
	assert.equal(info.precise, false);
	process.env.FORCED_ALIGN_ENGINE = 'ctc';
	try {
		assert.deepEqual(alignEngineInfo(), { engine: 'ctc', precise: true, available: ['ctc'] });
	} finally {
		delete process.env.FORCED_ALIGN_ENGINE;
	}
	resetAlignEngineProbe();
});

test('ensureAlignedLyrics skips a community word-level track when only energy is available', () => {
	const calls = [];
	const result = ensureAlignedLyrics({
		artist: 'Karaoke Artist',
		title: 'Karaoke Song',
		duration: 200,
		plainLyrics: 'la la la',
		position: 0,
		communityWordLevel: true,
		engine: ENERGY,
		spawnFn: (bin) => {
			calls.push(bin);
			return fakeChild();
		},
		findBinary: () => '/usr/bin/parec'
	});
	assert.equal(result, null);
	assert.equal(calls.length, 0);
});

test('ensureAlignedLyrics with a precise engine records a community word-level track and stores a precise row', async () => {
	resetAlignEngineProbe();
	const calls = [];
	const fp = ensureAlignedLyrics({
		artist: 'Model Artist',
		title: 'Model Song',
		duration: 200,
		plainLyrics: 'hello there\nmy friend',
		position: 0,
		communityWordLevel: true,
		engine: QWEN,
		spawnFn: (bin, args) => {
			calls.push(bin);
			if (bin === 'parec') {
				const outPath = args[args.length - 1];
				mkdirSync(path.dirname(outPath), { recursive: true });
				writeFileSync(outPath, 'fake wav bytes');
			}
			if (bin === 'python3') {
				const outPath = args[args.length - 1];
				assert.ok(outPath.endsWith('aligned.json'), 'result lands in the job work dir, not a cache dir');
				writeFileSync(
					outPath,
					JSON.stringify({
						engine: 'qwen',
						precise: true,
						lines: [
							{
								time: 0.52,
								text: 'hello there',
								end: 1.4,
								words: [
									{ time: 0.52, text: 'hello', end: 0.91 },
									{ time: 1.02, text: 'there', end: 1.4 }
								]
							},
							{ time: 2.0, text: 'my friend', words: [{ time: 2.0, text: 'my', end: 2.2 }, { time: 2.25, text: 'friend', end: 2.7 }] }
						]
					})
				);
			}
			return fakeChild();
		},
		findBinary: () => '/usr/bin/parec'
	});
	assert.ok(fp);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(calls, ['parec', 'python3']);
	const info = readCachedAlignmentInfo(fp);
	assert.equal(info.engine, 'qwen');
	assert.equal(info.precise, true);
	assert.equal(info.lines[0].words[1].end, 1.4);
	const row = getAlignmentRow(fp);
	assert.equal(row.precise, true, 'the alignment is persisted in the DB');
	assert.equal(row.lines[1].words[1].text, 'friend');

	// Precise result on file: nothing more to do, even with the engine present.
	const again = ensureAlignedLyrics({
		artist: 'Model Artist',
		title: 'Model Song',
		duration: 200,
		plainLyrics: 'hello there\nmy friend',
		position: 0,
		engine: QWEN,
		spawnFn: () => assert.fail('must not re-record a precisely aligned track')
	});
	assert.equal(again, fp);
});

test('a legacy energy file is upgraded when a precise engine appears', async () => {
	const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'align-cache-'));
	process.env.FORCED_ALIGN_CACHE_DIR = cacheDir;
	const fp = trackFingerprint('Upgrade Artist', 'Upgrade Song', 200);
	writeFileSync(
		path.join(cacheDir, `${fp}.json`),
		JSON.stringify({ engine: 'energy', lines: [{ time: 0, text: 'hi there', words: [{ time: 0, text: 'hi' }, { time: 1, text: 'there' }] }] })
	);
	const before = readCachedAlignmentInfo(fp);
	assert.equal(before.precise, false);
	assert.equal(readCachedAlignment(fp)[0].text, 'hi there');

	const calls = [];
	const result = ensureAlignedLyrics({
		artist: 'Upgrade Artist',
		title: 'Upgrade Song',
		duration: 200,
		plainLyrics: 'hi there',
		position: 0,
		engine: QWEN,
		spawnFn: (bin) => {
			calls.push(bin);
			return new EventEmitter();
		},
		findBinary: () => '/usr/bin/parec'
	});
	assert.equal(result, fp);
	assert.equal(calls[0], 'parec', 'starts a fresh recording to replace the energy guess');
	assert.equal(isAlignmentInFlight(fp), true);
	cancelOtherAlignments('something-else');
});

test('alignmentQuality prefers monotonic clocks with real end times over a collapsed pass', () => {
	const community = [
		{
			time: 1,
			text: 'Hello there friend',
			words: [
				{ time: 1, text: 'Hello', end: 1.3 },
				{ time: 1.4, text: 'there', end: 1.7 },
				{ time: 1.8, text: 'friend', end: 2.2 }
			]
		}
	];
	const collapsed = [
		{
			time: 1,
			text: 'Hello there friend',
			words: [
				{ time: 1, text: 'Hello', end: 1 },
				{ time: 1, text: 'there', end: 1 },
				{ time: 1, text: 'friend', end: 1 }
			]
		}
	];
	assert.ok(alignmentQuality(community, { duration: 200 }) > alignmentQuality(collapsed, { duration: 200 }));
	assert.equal(isBetterAlignment(collapsed, community, 200), false);
	assert.equal(isBetterAlignment(community, collapsed, 200), true);
});

test('a saved speaker recording is enough to align even if we joined the track late', async () => {
	resetAlignEngineProbe();
	const fp = trackFingerprint('Saved Wav Artist', 'Saved Wav Song', 200);
	const wav = path.join(process.env.FORCED_ALIGN_AUDIO_DIR, `${fp}.wav`);
	writeFileSync(wav, 'saved wav bytes');
	putRecordingRow(fp, { path: wav, offsetSec: 0, durationSec: 200 });
	const calls = [];
	const result = ensureAlignedLyrics({
		artist: 'Saved Wav Artist',
		title: 'Saved Wav Song',
		duration: 200,
		plainLyrics: 'hello there',
		position: 40,
		engine: QWEN,
		spawnFn: (bin, args) => {
			calls.push(bin);
			if (bin === 'python3') {
				writeFileSync(
					args[args.length - 1],
					JSON.stringify({
						engine: 'qwen',
						precise: true,
						lines: [
							{
								time: 0.5,
								text: 'hello there',
								words: [
									{ time: 0.5, text: 'hello', end: 0.9 },
									{ time: 1.0, text: 'there', end: 1.4 }
								]
							}
						]
					})
				);
			}
			return fakeChild();
		}
	});
	assert.equal(result, fp);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(calls, ['python3']);
	assert.equal(readCachedAlignmentInfo(fp).engine, 'qwen');
});

test('sweepCachedLyrics aligns every cached lyric that already has a recording and skips the rest', async () => {
	resetAlignEngineProbe();
	const withAudio = trackFingerprint('Sweep Artist', 'Has Audio', 200);
	const wav = path.join(process.env.FORCED_ALIGN_AUDIO_DIR, `${withAudio}.wav`);
	writeFileSync(wav, 'sweep wav');
	putLyricsRow('sweep|has audio||200', {
		artist: 'Sweep Artist',
		title: 'Has Audio',
		duration: 200,
		plainText: 'hello there',
		lines: [{ time: 1, text: 'hello there' }],
		fetchedAt: Date.now(),
		ttl: 60_000
	});
	putRecordingRow(withAudio, { path: wav, offsetSec: 0, durationSec: 200 });
	putLyricsRow('sweep|no audio||200', {
		artist: 'Sweep Artist',
		title: 'No Audio',
		duration: 200,
		plainText: 'never recorded',
		lines: [{ time: 1, text: 'never recorded' }],
		fetchedAt: Date.now(),
		ttl: 60_000
	});
	const calls = [];
	const summary = sweepCachedLyrics({
		engine: QWEN,
		spawnFn: (bin, args) => {
			calls.push(bin);
			writeFileSync(
				args[args.length - 1],
				JSON.stringify({
					engine: 'qwen',
					precise: true,
					lines: [
						{
							time: 0.4,
							text: 'hello there',
							words: [
								{ time: 0.4, text: 'hello', end: 0.8 },
								{ time: 0.9, text: 'there', end: 1.3 }
							]
						}
					]
				})
			);
			return fakeChild();
		}
	});
	assert.ok(summary.haveAudio >= 1);
	assert.ok(summary.queued >= 1);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.ok(calls.includes('python3'));
	assert.equal(readCachedAlignmentInfo(withAudio).engine, 'qwen');
	assert.equal(readCachedAlignmentInfo(trackFingerprint('Sweep Artist', 'No Audio', 200)), null);
});
