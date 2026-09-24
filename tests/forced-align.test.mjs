import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LYRICS_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), 'align-db-')), 'lyrics.db');

import {
	alignEngineInfo,
	cancelOtherAlignments,
	checkAlignmentRecording,
	ensureAlignedLyrics,
	isAlignmentInFlight,
	probeAlignEngine,
	readCachedAlignment,
	readCachedAlignmentInfo,
	resetAlignEngineProbe,
	shouldAlign,
	trackFingerprint,
	wavDurationSec
} from '../src/lib/server/forcedAlign.js';
import { getAlignmentRow, putAlignmentRow } from '../src/lib/server/lyricsStore.js';

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

test('shouldAlign: a precise engine aligns tracks without human word clocks until a precise result exists', () => {
	assert.equal(shouldAlign({ cached: null, engine: QWEN, communityWordLevel: true }), false, 'human karaoke already wins');
	assert.equal(shouldAlign({ cached: null, engine: QWEN, communityWordLevel: false }), true);
	assert.equal(
		shouldAlign({ cached: { engine: 'energy', precise: false }, engine: QWEN, communityWordLevel: false }),
		true,
		'an energy guess gets upgraded once a real aligner is installed'
	);
	assert.equal(shouldAlign({ cached: { engine: 'qwen', precise: true }, engine: QWEN, force: true }), true, 'realign');
	assert.equal(shouldAlign({ cached: { engine: 'qwen', precise: true }, engine: QWEN }), false);
	assert.equal(shouldAlign({ cached: { engine: 'ctc', precise: true }, engine: ENERGY }), false);
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

test('probeAlignEngine forwards whisperx host fields from align.py --probe', async () => {
	resetAlignEngineProbe();
	delete process.env.FORCED_ALIGN_ENGINE;
	const info = await probeAlignEngine({
		spawnFn: () =>
			fakeProbeChild(
				JSON.stringify({
					engine: 'whisperx',
					precise: true,
					available: ['whisperx', 'energy'],
					device: 'cpu',
					separate: true,
					whisper_model: 'large-v3',
					align_model: 'jonatasgrosman/wav2vec2-large-xlsr-53-english',
					python: '/home/das/venvs/lyrix/bin/python',
					python_version: '3.12.3',
					note: 'python 3.14 cannot import whisperx'
				})
			)
	});
	assert.equal(info.engine, 'whisperx');
	assert.equal(info.device, 'cpu');
	assert.equal(info.separate, true);
	assert.equal(info.whisperModel, 'large-v3');
	assert.equal(info.alignModel, 'jonatasgrosman/wav2vec2-large-xlsr-53-english');
	assert.equal(info.python, '/home/das/venvs/lyrix/bin/python');
	assert.equal(info.pythonVersion, '3.12.3');
	assert.match(info.note, /3\.14/);
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

test('ensureAlignedLyrics with a precise engine records a line-synced track and stores a precise row', async () => {
	resetAlignEngineProbe();
	const calls = [];
	const fp = ensureAlignedLyrics({
		artist: 'Model Artist',
		title: 'Model Song',
		duration: 200,
		plainLyrics: 'hello there\nmy friend',
		position: 0,
		communityWordLevel: false,
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
	await new Promise((resolve) => setTimeout(resolve, 20));
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

/** A recorder that stays open until killed, then exits cleanly (code null)
 *  the way parec does on SIGTERM. */
function hangingRecorder(calls) {
	return (bin, args) => {
		calls.push(bin);
		const proc = new EventEmitter();
		proc.stderr = new EventEmitter();
		if (bin === 'parec') {
			const outPath = args[args.length - 1];
			mkdirSync(path.dirname(outPath), { recursive: true });
			writeFileSync(outPath, 'fake wav bytes');
			proc.kill = () => queueMicrotask(() => proc.emit('exit', null));
			return proc;
		}
		queueMicrotask(() => proc.emit('exit', 0));
		return proc;
	};
}

test('a capture cancelled by a track skip is never aligned or cached', async () => {
	const calls = [];
	const fp = ensureAlignedLyrics({
		artist: 'Skipped Artist',
		title: 'Skipped Song',
		duration: 200,
		plainLyrics: 'one\ntwo',
		position: 0,
		engine: QWEN,
		spawnFn: hangingRecorder(calls),
		findBinary: () => '/usr/bin/parec'
	});
	cancelOtherAlignments(trackFingerprint('Next Artist', 'Next Song', 200));
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(calls, ['parec'], 'align.py must not run on the partial WAV');
	assert.equal(readCachedAlignmentInfo(fp), null);
	assert.equal(isAlignmentInFlight(fp), false);
});

test('checkAlignmentRecording cancels the capture on a pause or a scrub, not on normal play', async () => {
	const calls = [];
	const fp = ensureAlignedLyrics({
		artist: 'Scrub Artist',
		title: 'Scrub Song',
		duration: 200,
		plainLyrics: 'one\ntwo',
		position: 2,
		engine: QWEN,
		spawnFn: hangingRecorder(calls),
		findBinary: () => '/usr/bin/parec'
	});
	const now = Date.now();
	assert.equal(checkAlignmentRecording(fp, { playing: true, position: 2.5, now: now + 500 }), false);
	assert.equal(checkAlignmentRecording(fp, { playing: true, position: 60, now: now + 1000 }), true);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(calls, ['parec']);
	assert.equal(readCachedAlignmentInfo(fp), null);
});

function writeWav(file, seconds, rate = 8000) {
	const data = Buffer.alloc(Math.round(seconds * rate * 2));
	const header = Buffer.alloc(44);
	header.write('RIFF', 0, 'ascii');
	header.writeUInt32LE(36 + data.length, 4);
	header.write('WAVE', 8, 'ascii');
	header.write('fmt ', 12, 'ascii');
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36, 'ascii');
	header.writeUInt32LE(data.length, 40);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, Buffer.concat([header, data]));
}

test('wavDurationSec reads the captured length from the header, null for non-WAV', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'wav-'));
	writeWav(path.join(dir, 'a.wav'), 3);
	assert.ok(Math.abs(wavDurationSec(path.join(dir, 'a.wav')) - 3) < 1e-6);
	writeFileSync(path.join(dir, 'b.wav'), 'nope');
	assert.equal(wavDurationSec(path.join(dir, 'b.wav')), null);
});

test('a capture that ended far short of the track is not aligned', async () => {
	const calls = [];
	const fp = ensureAlignedLyrics({
		artist: 'Crash Artist',
		title: 'Crash Song',
		duration: 200,
		plainLyrics: 'one\ntwo',
		position: 0,
		engine: QWEN,
		spawnFn: (bin, args) => {
			calls.push(bin);
			if (bin === 'parec') writeWav(args[args.length - 1], 5);
			return fakeChild();
		},
		findBinary: () => '/usr/bin/parec'
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(calls, ['parec']);
	assert.equal(readCachedAlignmentInfo(fp), null);
});

test('an alignment timed against a censored sheet is dropped so it can be redone', () => {
	const fp = trackFingerprint('Masked Artist', 'Masked Song', 200);
	putAlignmentRow(fp, {
		lines: [{ time: 1, text: 'f**k it', words: [{ time: 1, text: 'f' }, { time: 1.2, text: 'k' }, { time: 1.4, text: 'it' }] }],
		engine: 'wav2vec',
		precise: true,
		createdAt: Date.now()
	});
	assert.equal(readCachedAlignmentInfo(fp), null);
	assert.equal(getAlignmentRow(fp), null);
});
