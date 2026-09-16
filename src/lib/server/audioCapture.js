import { execSync, spawn } from 'node:child_process';

import { bassMagnitude, bucketizeLog, createAgcBank, hannWindow, magnitudeSpectrum } from './audioAnalysis.js';

// 48kHz matches what shairport-sync/AirPlay already streams at, so the tap
// doesn't downsample below the source. 2048 samples gives ~23Hz frequency
// resolution (48000/2048) at ~30fps (2048/48000 ~= 43ms of audio per frame,
// close enough to a 33ms tick that the ring buffer always has fresh data).
export const SAMPLE_RATE = 48000;
export const FFT_SIZE = 2048;
export const BUCKET_COUNT = 32;
export const FRAME_MS = 33;

function which(bin) {
	try {
		return execSync(`command -v ${bin} 2>/dev/null`, { encoding: 'utf8' }).trim() || null;
	} catch {
		return null;
	}
}

function captureCommand(findBinary) {
	// parec (the PulseAudio client, served by pipewire-pulse on this box) can
	// address a sink's monitor by name, which is how we tap what's actually
	// playing instead of an input mic. pw-record has no monitor shorthand, so
	// it's a lower-quality fallback that just records the default source.
	if (findBinary('parec')) {
		return {
			bin: 'parec',
			args: ['-d', '@DEFAULT_MONITOR@', '--format=s16le', `--rate=${SAMPLE_RATE}`, '--channels=1', '--raw']
		};
	}
	if (findBinary('pw-record')) {
		return { bin: 'pw-record', args: ['--channels=1', `--rate=${SAMPLE_RATE}`, '--format=s16', '-'] };
	}
	return null;
}

/** Taps system audio (whatever's playing through the default sink) and
 *  streams normalized spectrum/bass frames to `onFrame`. Returns
 *  {start, stop, active} - safe to call start()/stop() repeatedly; only one
 *  capture process runs at a time. Silently no-ops if neither parec nor
 *  pw-record is installed, same as the rest of kioskStatus's optional
 *  binaries. */
export function createAudioCapture({ onFrame, spawnFn = spawn, findBinary = which } = {}) {
	let child = null;
	let timer = 0;
	let leftover = Buffer.alloc(0);
	const ring = new Float32Array(FFT_SIZE);
	let writeIdx = 0;
	let filled = false;
	const window = hannWindow(FFT_SIZE);
	const agc = createAgcBank(BUCKET_COUNT + 1);

	function pushSamples(chunk) {
		const combined = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
		const usable = combined.length - (combined.length % 2);
		for (let i = 0; i < usable; i += 2) {
			ring[writeIdx] = combined.readInt16LE(i) / 32768;
			writeIdx = (writeIdx + 1) % FFT_SIZE;
			if (writeIdx === 0) filled = true;
		}
		leftover = usable < combined.length ? combined.subarray(usable) : Buffer.alloc(0);
	}

	function emitFrame() {
		if (!filled) return;
		const linear = new Float32Array(FFT_SIZE);
		for (let i = 0; i < FFT_SIZE; i++) linear[i] = ring[(writeIdx + i) % FFT_SIZE];
		const mags = magnitudeSpectrum(linear, window);
		const rawBins = bucketizeLog(mags, { sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, bucketCount: BUCKET_COUNT });
		const rawBass = bassMagnitude(mags, { sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
		const normalized = agc.normalize([rawBass, ...rawBins]);
		onFrame({ bass: normalized[0], bins: Array.from(normalized.slice(1)) });
	}

	function stop() {
		if (timer) clearInterval(timer);
		timer = 0;
		if (child) {
			try {
				child.kill('SIGTERM');
			} catch {
				/* already gone */
			}
		}
		child = null;
		writeIdx = 0;
		filled = false;
		leftover = Buffer.alloc(0);
	}

	function start() {
		if (child) return true;
		const cmd = captureCommand(findBinary);
		if (!cmd) return false;
		try {
			child = spawnFn(cmd.bin, cmd.args, { stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			child = null;
			return false;
		}
		child.stdout?.on('data', pushSamples);
		child.on('error', stop);
		child.on('exit', () => {
			child = null;
		});
		timer = setInterval(emitFrame, FRAME_MS);
		return true;
	}

	return {
		start,
		stop,
		get active() {
			return Boolean(child);
		}
	};
}

/** One-shot capture of whatever's playing through the default sink straight
 *  to a WAV file, for the forced-alignment fallback in forcedAlign.js -
 *  unlike createAudioCapture() above (a live spectrum tap), this records a
 *  full track to disk so it can be handed to Demucs/MFA afterward. Resolves
 *  `done` to whether the recorder produced output, either because
 *  `durationSec` elapsed or `stop()` was called early (e.g. the track
 *  changed underneath it). `pw-record` has no monitor-source shorthand like
 *  parec's `@DEFAULT_MONITOR@`, so on pw-record-only systems this records
 *  the default *source* instead - fine for a wired/AirPlay setup where that
 *  is the sink loopback, but not a guaranteed monitor tap. */
export function recordToWavFile({ outPath, durationSec = 0, spawnFn = spawn, findBinary = which } = {}) {
	let child = null;
	let timer = 0;
	const done = new Promise((resolve) => {
		const cmd = findBinary('parec')
			? { bin: 'parec', args: ['-d', '@DEFAULT_MONITOR@', '--file-format=wav', outPath] }
			: findBinary('pw-record')
				? { bin: 'pw-record', args: ['--channels=2', outPath] }
				: null;
		if (!cmd) {
			resolve(false);
			return;
		}
		try {
			child = spawnFn(cmd.bin, cmd.args, { stdio: ['ignore', 'ignore', 'ignore'] });
		} catch {
			child = null;
			resolve(false);
			return;
		}
		child.on('error', () => {
			child = null;
			resolve(false);
		});
		child.on('exit', (code) => {
			child = null;
			resolve(code === 0 || code === null);
		});
		if (durationSec > 0) {
			timer = setTimeout(() => stop(), durationSec * 1000);
			// A multi-minute track-length timer shouldn't by itself keep the
			// process (or a test run) alive if everything else has finished.
			timer.unref?.();
		}
	});
	function stop() {
		if (timer) clearTimeout(timer);
		timer = 0;
		if (child) {
			try {
				child.kill('SIGTERM');
			} catch {
				/* already gone */
			}
		}
	}
	return { done, stop };
}
