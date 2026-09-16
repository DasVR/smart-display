import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordToWavFile } from './audioCapture.js';
import { normalizeLyricText } from './lyrics.js';

const ALIGN_SCRIPT = fileURLToPath(new URL('../../../scripts/forced_align/align.py', import.meta.url));

// A function, not a module-load-time constant, so tests can point different
// cases at different cache dirs via process.env without needing a fresh
// module import per test.
function cacheDir() {
	return process.env.FORCED_ALIGN_CACHE_DIR || path.join(process.cwd(), 'data', 'forced-align-cache');
}

// Only worth starting a recording if we caught the track within this many
// seconds of its own start - otherwise the alignment would be missing its
// opening lines. Skip anything implausibly short/long to avoid wasting a
// CPU-minutes-scale job on bad duration data.
const START_WINDOW_SEC = 6;
const MIN_DURATION_SEC = 20;
const MAX_DURATION_SEC = 20 * 60;

const inFlight = new Set();

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

function runPythonAlign({ wavPath, lyricsTextPath, outJsonPath, spawnFn = spawn, pythonBin } = {}) {
	return new Promise((resolve) => {
		const bin = pythonBin || process.env.LYRICS_PYTHON_BIN || 'python3';
		let child;
		try {
			child = spawnFn(bin, [ALIGN_SCRIPT, wavPath, lyricsTextPath, outJsonPath], {
				stdio: ['ignore', 'ignore', 'pipe']
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

/** Kicks off a background job that records the rest of this track's
 *  play-through, isolates vocals with Demucs, and force-aligns the known
 *  plain lyric text against them with MFA - so the *next* time this song
 *  plays, cached word-level lyrics are available even though nothing
 *  online has synced lyrics for it. Never blocks or throws into the
 *  caller: it fires the job and returns immediately, and the current
 *  play-through just falls back to whatever fetchLyrics()/plain text
 *  already gave the UI. Silently no-ops if a job for this track is already
 *  running or cached, there's no plain lyric text to align against, the
 *  duration looks unusable, or we joined more than START_WINDOW_SEC into
 *  the track (missed the start - wait for the next play-through instead of
 *  recording a partial take). */
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

	const recordSec = Math.ceil(dur - Number(position) || 0) + 2;
	const { done } = recordToWavFile({ outPath: wavPath, durationSec: recordSec, spawnFn, findBinary });

	done
		.then((recorded) => {
			if (!recorded || !existsSync(wavPath)) return false;
			mkdirSync(cacheDir(), { recursive: true });
			return runPythonAlign({ wavPath, lyricsTextPath, outJsonPath: cachePath(fp), spawnFn, pythonBin });
		})
		.catch((error) => console.error('forced-align job failed:', error.message))
		.finally(cleanup);

	return fp;
}
