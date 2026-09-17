import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordToWavFile } from './audioCapture.js';
import { normalizeLyricText } from './lyrics.js';

const ALIGN_SCRIPT = fileURLToPath(new URL('../../../scripts/forced_align/align.py', import.meta.url));

function cacheDir() {
	return process.env.FORCED_ALIGN_CACHE_DIR || path.join(process.cwd(), 'data', 'forced-align-cache');
}

const START_WINDOW_SEC = 6;
const MIN_DURATION_SEC = 20;
const MAX_DURATION_SEC = 20 * 60;

const inFlight = new Set();
const recorders = new Map();

export function trackFingerprint(artist, title, duration) {
	const key = `${normalizeLyricText(artist)}|${normalizeLyricText(title)}|${Math.round(Number(duration) || 0)}`;
	return createHash('sha1').update(key).digest('hex').slice(0, 20);
}

function cachePath(fp) {
	return path.join(cacheDir(), `${fp}.json`);
}

export function readCachedAlignment(fp) {
	try {
		const file = cachePath(fp);
		if (!existsSync(file)) return null;
		const data = JSON.parse(readFileSync(file, 'utf8'));
		return Array.isArray(data?.lines) ? data.lines : null;
	} catch {
		return null;
	}
}

export function isAlignmentInFlight(fp) {
	return inFlight.has(fp);
}

export function cancelAlignment(fp) {
	const rec = recorders.get(fp);
	try {
		rec?.stop?.();
	} catch {
		/* already gone */
	}
	recorders.delete(fp);
}

/** Stop recordings that aren't for the track that's actually playing so a
 *  skip doesn't leave a multi-minute orphan WAV capture running. */
export function cancelOtherAlignments(keepFp) {
	for (const fp of [...recorders.keys()]) {
		if (fp !== keepFp) cancelAlignment(fp);
	}
}

function runPythonAlign({ wavPath, lyricsTextPath, outJsonPath, spawnFn = spawn, pythonBin, offsetSec = 0 } = {}) {
	return new Promise((resolve) => {
		const bin = pythonBin || process.env.LYRICS_PYTHON_BIN || 'python3';
		let child;
		try {
			child = spawnFn(bin, [ALIGN_SCRIPT, wavPath, lyricsTextPath, outJsonPath], {
				stdio: ['ignore', 'ignore', 'pipe'],
				env: { ...process.env, FORCED_ALIGN_OFFSET: String(offsetSec || 0) }
			});
		} catch {
			resolve(false);
			return;
		}
		let stderr = '';
		child.stderr?.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', () => resolve(false));
		child.on('exit', (code) => {
			if (code !== 0) console.error('forced-align failed:', stderr.slice(-2000));
			resolve(code === 0);
		});
	});
}

/** Records the rest of this play-through and force-aligns known plain lyric
 *  text against it on-device (energy envelope by default; CTC/aeneas/MFA
 *  if installed). Fire-and-forget: the current poll still returns whatever
 *  online sources had, and a later poll of the same track picks up the
 *  cached word clocks. */
export function ensureAlignedLyrics({
	artist,
	title,
	duration,
	plainLyrics,
	position = 0,
	spawnFn,
	findBinary,
	pythonBin
} = {}) {
	const dur = Number(duration) || 0;
	const fp = trackFingerprint(artist, title, dur);
	if (readCachedAlignment(fp)) return fp;
	if (inFlight.has(fp)) return fp;
	if (!plainLyrics || !dur || dur < MIN_DURATION_SEC || dur > MAX_DURATION_SEC) return null;
	if (Number(position) > START_WINDOW_SEC) return null;

	inFlight.add(fp);
	const workDir = path.join(os.tmpdir(), `smart-display-align-${fp}`);
	const wavPath = path.join(workDir, 'track.wav');
	const lyricsTextPath = path.join(workDir, 'lyrics.txt');
	const cleanup = () => {
		inFlight.delete(fp);
		recorders.delete(fp);
		try {
			rmSync(workDir, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	};

	try {
		mkdirSync(workDir, { recursive: true });
		writeFileSync(lyricsTextPath, plainLyrics);
	} catch (error) {
		console.error('forced-align setup failed:', error.message);
		cleanup();
		return null;
	}

	const offsetSec = Number(position) || 0;
	const recordSec = Math.ceil(dur - offsetSec) + 2;
	const recorder = recordToWavFile({ outPath: wavPath, durationSec: recordSec, spawnFn, findBinary });
	recorders.set(fp, recorder);

	recorder.done
		.then((recorded) => {
			if (!recorded || !existsSync(wavPath)) return false;
			mkdirSync(cacheDir(), { recursive: true });
			return runPythonAlign({
				wavPath,
				lyricsTextPath,
				outJsonPath: cachePath(fp),
				spawnFn,
				pythonBin,
				offsetSec
			});
		})
		.catch((error) => console.error('forced-align job failed:', error.message))
		.finally(cleanup);

	return fp;
}
