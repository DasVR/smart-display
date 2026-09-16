/** Pure DSP helpers for the live audio-reactive visuals. No I/O here - safe
 *  to unit test without spawning a capture process. audioCapture.js owns the
 *  subprocess and streams raw PCM through these functions. */

/** In-place iterative radix-2 Cooley-Tukey FFT. `real`/`imag` must be
 *  same-length typed arrays whose length is a power of two; `imag` is
 *  usually all zeros going in for a real-valued signal. */
export function fft(real, imag) {
	const n = real.length;
	if (n !== imag.length) throw new Error('fft: real/imag length mismatch');
	if (n === 0 || (n & (n - 1)) !== 0) throw new Error('fft: size must be a power of two');

	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[real[i], real[j]] = [real[j], real[i]];
			[imag[i], imag[j]] = [imag[j], imag[i]];
		}
	}

	for (let len = 2; len <= n; len <<= 1) {
		const half = len >> 1;
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let curWr = 1;
			let curWi = 0;
			for (let k = 0; k < half; k++) {
				const a = i + k;
				const b = a + half;
				const vRe = real[b] * curWr - imag[b] * curWi;
				const vIm = real[b] * curWi + imag[b] * curWr;
				const uRe = real[a];
				const uIm = imag[a];
				real[a] = uRe + vRe;
				imag[a] = uIm + vIm;
				real[b] = uRe - vRe;
				imag[b] = uIm - vIm;
				const nextWr = curWr * wr - curWi * wi;
				const nextWi = curWr * wi + curWi * wr;
				curWr = nextWr;
				curWi = nextWi;
			}
		}
	}
}

/** Hann window, tapering both ends to 0 so the FFT doesn't ring on the
 *  block edges of a continuous signal. */
export function hannWindow(size) {
	const w = new Float32Array(size);
	if (size === 1) {
		w[0] = 1;
		return w;
	}
	for (let i = 0; i < size; i++) {
		w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
	}
	return w;
}

/** Windows `samples` (length must match `window`), runs the FFT, and
 *  returns the magnitude of the first half of the spectrum (DC..Nyquist). */
export function magnitudeSpectrum(samples, window) {
	const n = samples.length;
	const real = new Float64Array(n);
	const imag = new Float64Array(n);
	for (let i = 0; i < n; i++) real[i] = samples[i] * window[i];
	fft(real, imag);
	const half = n / 2;
	const mags = new Float64Array(half);
	for (let i = 0; i < half; i++) mags[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
	return mags;
}

function binForFreq(freq, sampleRate, fftSize) {
	return (freq * fftSize) / sampleRate;
}

/** Groups the magnitude spectrum into `bucketCount` log-spaced bands between
 *  `minFreq` and `maxFreq` (human hearing is log-scaled, so equal-width
 *  linear bins would crowd all the visible motion into the first few bars).
 *  Each bucket takes the loudest bin in its range, which reads as a snappier
 *  bar than an average. */
export function bucketizeLog(
	magnitudes,
	{ sampleRate, fftSize, bucketCount = 32, minFreq = 40, maxFreq = 16000 } = {}
) {
	const bins = new Float64Array(bucketCount);
	const nyquist = sampleRate / 2;
	const hiFreq = Math.min(maxFreq, nyquist);
	const ratio = hiFreq / minFreq;
	for (let b = 0; b < bucketCount; b++) {
		const loF = minFreq * Math.pow(ratio, b / bucketCount);
		const hiF = minFreq * Math.pow(ratio, (b + 1) / bucketCount);
		const loBin = Math.max(0, Math.floor(binForFreq(loF, sampleRate, fftSize)));
		const hiBin = Math.min(magnitudes.length - 1, Math.ceil(binForFreq(hiF, sampleRate, fftSize)));
		let max = 0;
		for (let k = loBin; k <= hiBin; k++) {
			if (magnitudes[k] > max) max = magnitudes[k];
		}
		bins[b] = max;
	}
	return bins;
}

/** Average magnitude across a low-frequency band, used to drive the
 *  background shader's kick/bass pulse. */
export function bassMagnitude(magnitudes, { sampleRate, fftSize, minFreq = 20, maxFreq = 180 } = {}) {
	const loBin = Math.max(1, Math.floor(binForFreq(minFreq, sampleRate, fftSize)));
	const hiBin = Math.min(magnitudes.length - 1, Math.ceil(binForFreq(maxFreq, sampleRate, fftSize)));
	let sum = 0;
	let count = 0;
	for (let k = loBin; k <= hiBin; k++) {
		sum += magnitudes[k];
		count++;
	}
	return count ? sum / count : 0;
}

const MIN_DB = -70;

function toDb(x) {
	return 20 * Math.log10(Math.max(x, 1e-8));
}

/** Turns raw FFT magnitudes into 0..1 values that look good regardless of
 *  the track's mastering loudness. Each channel tracks its own recent peak
 *  as a moving "ceiling": it snaps up fast on a new peak (so transients
 *  register immediately) and relaxes slowly on the way down (so a quiet
 *  passage after a loud chorus doesn't instantly go flat). Silence always
 *  reads as 0 regardless of where the ceiling has drifted. */
export function createAgcBank(count, { attack = 0.5, release = 0.06, floorDb = MIN_DB, headroomDb = 6 } = {}) {
	const ceiling = new Float64Array(count).fill(floorDb + headroomDb);
	return {
		normalize(rawValues) {
			const out = new Float64Array(count);
			for (let i = 0; i < count; i++) {
				const db = toDb(rawValues[i] ?? 0);
				const target = Math.max(db, floorDb);
				const rate = target > ceiling[i] ? attack : release;
				ceiling[i] += (target - ceiling[i]) * rate;
				const top = Math.max(ceiling[i], floorDb + headroomDb);
				out[i] = Math.max(0, Math.min(1, (db - floorDb) / (top - floorDb)));
			}
			return out;
		}
	};
}
