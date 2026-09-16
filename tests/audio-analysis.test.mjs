import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	bassMagnitude,
	bucketizeLog,
	createAgcBank,
	fft,
	hannWindow,
	magnitudeSpectrum
} from '../src/lib/server/audioAnalysis.js';

test('fft finds the peak bin of a pure sine wave', () => {
	const n = 1024;
	const sampleRate = 48000;
	const targetBin = 40; // 40 * 48000/1024 = 1875 Hz
	const freq = (targetBin * sampleRate) / n;
	const real = new Float64Array(n);
	const imag = new Float64Array(n);
	for (let i = 0; i < n; i++) real[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);

	fft(real, imag);

	let peakBin = 0;
	let peakMag = -1;
	for (let k = 0; k < n / 2; k++) {
		const mag = Math.hypot(real[k], imag[k]);
		if (mag > peakMag) {
			peakMag = mag;
			peakBin = k;
		}
	}
	assert.equal(peakBin, targetBin);
});

test('fft rejects non-power-of-two sizes and mismatched arrays', () => {
	assert.throws(() => fft(new Float64Array(10), new Float64Array(10)));
	assert.throws(() => fft(new Float64Array(8), new Float64Array(4)));
});

test('hannWindow tapers to zero at the edges and peaks in the middle', () => {
	const w = hannWindow(9);
	assert.equal(w[0], 0);
	assert.equal(w[8], 0);
	assert.ok(w[4] > 0.99);
});

test('magnitudeSpectrum reports energy at the driven frequency', () => {
	const n = 512;
	const sampleRate = 48000;
	const targetBin = 20;
	const freq = (targetBin * sampleRate) / n;
	const window = hannWindow(n);
	const samples = new Float32Array(n);
	for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);

	const mags = magnitudeSpectrum(samples, window);
	let peakBin = 0;
	let peakMag = -1;
	for (let k = 0; k < mags.length; k++) {
		if (mags[k] > peakMag) {
			peakMag = mags[k];
			peakBin = k;
		}
	}
	assert.ok(Math.abs(peakBin - targetBin) <= 1);
});

test('bucketizeLog assigns a low frequency to an early bucket and a high one to a late bucket', () => {
	const sampleRate = 48000;
	const fftSize = 2048;
	const half = fftSize / 2;
	const mags = new Float64Array(half);
	const lowBin = Math.round((100 * fftSize) / sampleRate);
	const highBin = Math.round((8000 * fftSize) / sampleRate);
	mags[lowBin] = 1;
	mags[highBin] = 1;

	const bins = bucketizeLog(mags, { sampleRate, fftSize, bucketCount: 32 });
	const loudBuckets = [...bins].map((v, i) => (v > 0.5 ? i : -1)).filter((i) => i >= 0);
	// Near the FFT's DC end, log-bucket edges can be finer than a single bin's
	// frequency width, so one low spike can land in a couple of adjacent early
	// buckets - that's expected. What matters is the low spike stays confined
	// to the low end and the high spike to the high end, with nothing lit up
	// in between.
	assert.ok(loudBuckets.every((i) => i < 10 || i > 20));
	assert.ok(loudBuckets.some((i) => i < 10));
	assert.ok(loudBuckets.some((i) => i > 20));
});

test('bassMagnitude averages only the low-frequency band', () => {
	const sampleRate = 48000;
	const fftSize = 2048;
	const half = fftSize / 2;
	const mags = new Float64Array(half);
	const bassBin = Math.round((60 * fftSize) / sampleRate);
	mags[bassBin] = 2;
	const trebleBin = Math.round((10000 * fftSize) / sampleRate);
	mags[trebleBin] = 5;

	const bass = bassMagnitude(mags, { sampleRate, fftSize });
	assert.ok(bass > 0);
	assert.ok(bass < 2); // averaged over the band, not just the one spike
});

test('createAgcBank normalizes silence to 0 and sustained loud input toward 1', () => {
	const agc = createAgcBank(1);
	const [silent] = agc.normalize([0]);
	assert.equal(silent, 0);

	let last = 0;
	for (let i = 0; i < 50; i++) {
		[last] = agc.normalize([1]);
	}
	assert.ok(last > 0.9);
});

test('createAgcBank ceiling relaxes slowly, keeping quieter follow-up frames visible', () => {
	const agc = createAgcBank(1, { attack: 1, release: 0.05 });
	agc.normalize([1]); // slam the ceiling up
	const [afterQuiet] = agc.normalize([0.1]);
	assert.ok(afterQuiet > 0, 'a quieter frame right after a peak should still read above zero');
});
