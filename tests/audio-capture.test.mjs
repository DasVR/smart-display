import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createAudioCapture, FFT_SIZE, recordToWavFile } from '../src/lib/server/audioCapture.js';

function fakeChild() {
	const proc = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.kill = () => proc.emit('exit', 0);
	return proc;
}

test('createAudioCapture no-ops when neither parec nor pw-record is installed', () => {
	const capture = createAudioCapture({ onFrame: () => {}, findBinary: () => null });
	assert.equal(capture.start(), false);
	assert.equal(capture.active, false);
});

test('createAudioCapture prefers parec, falls back to pw-record', () => {
	const calls = [];
	const spawnFn = (bin, args) => {
		calls.push(bin);
		return fakeChild();
	};
	const onlyPwRecord = createAudioCapture({
		onFrame: () => {},
		spawnFn,
		findBinary: (bin) => (bin === 'pw-record' ? '/usr/bin/pw-record' : null)
	});
	assert.equal(onlyPwRecord.start(), true);
	assert.equal(calls[0], 'pw-record');
	onlyPwRecord.stop();

	const both = createAudioCapture({
		onFrame: () => {},
		spawnFn,
		findBinary: () => '/usr/bin/whatever'
	});
	assert.equal(both.start(), true);
	assert.equal(calls[1], 'parec');
	both.stop();
});

test('createAudioCapture streams PCM into normalized frames', async () => {
	const frames = [];
	let proc;
	const capture = createAudioCapture({
		onFrame: (f) => frames.push(f),
		spawnFn: () => (proc = fakeChild()),
		findBinary: () => '/usr/bin/parec'
	});
	assert.equal(capture.start(), true);
	assert.equal(capture.active, true);

	// A 200Hz tone, enough samples to fill the ring buffer at least once.
	const sampleCount = FFT_SIZE * 2;
	const buf = Buffer.alloc(sampleCount * 2);
	for (let i = 0; i < sampleCount; i++) {
		const v = Math.sin((2 * Math.PI * 200 * i) / 48000) * 20000;
		buf.writeInt16LE(Math.round(v), i * 2);
	}
	proc.stdout.emit('data', buf);

	await new Promise((resolve) => setTimeout(resolve, 120));

	assert.ok(frames.length > 0, 'expected at least one emitted frame');
	const last = frames[frames.length - 1];
	assert.equal(last.bins.length, 32);
	assert.ok(last.bass >= 0 && last.bass <= 1);
	assert.ok(last.bins.every((v) => v >= 0 && v <= 1));

	capture.stop();
	assert.equal(capture.active, false);
});

test('createAudioCapture stop() is idempotent and clears state', () => {
	const capture = createAudioCapture({
		onFrame: () => {},
		spawnFn: () => fakeChild(),
		findBinary: () => '/usr/bin/parec'
	});
	capture.start();
	capture.stop();
	capture.stop();
	assert.equal(capture.active, false);
});

test('recordToWavFile resolves false when neither parec nor pw-record is installed', async () => {
	const { done } = recordToWavFile({ outPath: '/tmp/x.wav', findBinary: () => null });
	assert.equal(await done, false);
});

function fakeRecorderChild() {
	const proc = fakeChild();
	queueMicrotask(() => proc.emit('exit', 0));
	return proc;
}

test('recordToWavFile writes straight to a file with parec, resolving true on clean exit', async () => {
	const calls = [];
	const { done } = recordToWavFile({
		outPath: '/tmp/track.wav',
		spawnFn: (bin, args) => {
			calls.push([bin, args]);
			return fakeRecorderChild();
		},
		findBinary: () => '/usr/bin/parec'
	});
	assert.deepEqual(calls[0][0], 'parec');
	assert.ok(calls[0][1].includes('/tmp/track.wav'));
	assert.ok(calls[0][1].includes('--file-format=wav'));
	assert.equal(await done, true);
});

test('recordToWavFile.stop() ends the recording early and still resolves', async () => {
	const { done, stop } = recordToWavFile({
		outPath: '/tmp/track.wav',
		spawnFn: () => fakeChild(),
		findBinary: () => '/usr/bin/parec'
	});
	stop();
	assert.equal(await done, true);
});

