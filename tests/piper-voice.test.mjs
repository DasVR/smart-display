import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPiper, listPiperVoices, voiceLabel } from '../src/lib/server/piperVoice.js';

function voicesDir(names) {
	const dir = mkdtempSync(path.join(tmpdir(), 'piper-'));
	for (const n of names) {
		mkdirSync(path.join(dir, `vits-piper-${n}`));
		writeFileSync(path.join(dir, `vits-piper-${n}`, `${n}.onnx`), 'x');
	}
	mkdirSync(path.join(dir, 'vits-piper-en_US-half-medium')); // no model file yet: not a voice
	return dir;
}

function fakeSherpa() {
	const made = [];
	const written = [];
	class OfflineTts {
		constructor(cfg) {
			made.push(cfg);
		}
		async generateAsync({ text }) {
			return { samples: new Float32Array(text.length * 10), sampleRate: 22050 };
		}
	}
	return { made, written, mod: { OfflineTts, writeWave: (file, wave) => written.push({ file, n: wave.samples.length }) } };
}

test('voiceLabel', () => {
	assert.equal(voiceLabel('en_US-lessac-medium'), 'Lessac (US English)');
	assert.equal(voiceLabel('en_GB-alan-medium'), 'Alan (British English)');
	assert.equal(voiceLabel('weird'), 'weird');
});

test('listPiperVoices finds only voices whose model is there', () => {
	const dir = voicesDir(['en_US-lessac-medium', 'en_GB-alan-medium']);
	assert.deepEqual(
		listPiperVoices(dir).map((v) => v.name),
		['en_GB-alan-medium', 'en_US-lessac-medium']
	);
	assert.deepEqual(listPiperVoices('/nope'), []);
});

test('speak loads a voice once and writes a wav; falls back to an installed voice', async () => {
	const dir = voicesDir(['en_GB-alan-medium']);
	const fake = fakeSherpa();
	const piper = createPiper({ dir, loadSherpa: async () => fake.mod, log: {} });
	const out = path.join(dir, 'a.wav');
	assert.deepEqual(await piper.speak('Hello there.', out, 'en_US-lessac-medium'), { ok: true, voice: 'en_GB-alan-medium' });
	await piper.speak('Again.', out, 'en_GB-alan-medium');
	assert.equal(fake.made.length, 1, 'the voice stays loaded');
	assert.match(fake.made[0].model.vits.model, /en_GB-alan-medium\.onnx$/);
	assert.equal(fake.made[0].model.numThreads, 2);
	assert.equal(fake.written.length, 2);
});

test('speak reports a missing voice or engine instead of throwing', async () => {
	const none = createPiper({ dir: voicesDir([]), loadSherpa: async () => assert.fail('not loaded'), log: {} });
	assert.deepEqual(await none.speak('Hi.', '/tmp/x.wav'), { ok: false, error: 'no-voice' });
	const broken = createPiper({
		dir: voicesDir(['en_US-lessac-medium']),
		loadSherpa: async () => {
			throw new Error('no addon');
		},
		log: {}
	});
	assert.deepEqual(await broken.speak('Hi.', '/tmp/x.wav'), { ok: false, error: 'no-engine' });
});
