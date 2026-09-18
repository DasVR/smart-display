import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordToWavFile } from './audioCapture.js';
import { normalizeLyricText } from './lyrics.js';
import { getAlignmentRow, putAlignmentRow } from './lyricsStore.js';

const ALIGN_SCRIPT = fileURLToPath(new URL('../../../scripts/forced_align/align.py', import.meta.url));

function legacyCacheDir() {
	return process.env.FORCED_ALIGN_CACHE_DIR || path.join(process.cwd(), 'data', 'forced-align-cache');
}

const START_WINDOW_SEC = 6;
const MIN_DURATION_SEC = 20;
const MAX_DURATION_SEC = 20 * 60;
// Importing torch + transformers for the probe can take a while on a cold
// disk; the probe only runs once per boot.
const PROBE_TIMEOUT_MS = 90_000;

/** Engines whose word clocks come from an acoustic model (frame-accurate),
 *  as opposed to `energy`, which spreads words across loud regions and is
 *  only a stand-in when nothing better is installed. Mirrors
 *  PRECISE_ENGINES in align.py. */
export const PRECISE_ENGINES = new Set(['qwen', 'ctc', 'aeneas', 'mfa']);

const inFlight = new Set();
const recorders = new Map();
// Process-local L1 over the alignments table; read on every poll.
const alignmentCache = new Map();

let enginePromise = null;
let engineInfo = null;

export function trackFingerprint(artist, title, duration) {
	const key = `${normalizeLyricText(artist)}|${normalizeLyricText(title)}|${Math.round(Number(duration) || 0)}`;
	return createHash('sha1').update(key).digest('hex').slice(0, 20);
}

export function isPreciseEngine(engine) {
	return PRECISE_ENGINES.has(String(engine || '').toLowerCase());
}

function legacyCachePath(fp) {
	return path.join(legacyCacheDir(), `${fp}.json`);
}

function readLegacyAlignment(fp) {
	try {
		const file = legacyCachePath(fp);
		if (!existsSync(file)) return null;
		const data = JSON.parse(readFileSync(file, 'utf8'));
		if (!Array.isArray(data?.lines) || !data.lines.length) return null;
		return {
			lines: data.lines,
			engine: data.engine || 'legacy',
			precise: Boolean(data.precise) || isPreciseEngine(data.engine),
			createdAt: 0
		};
	} catch {
		return null;
	}
}

/** `{ lines, engine, precise, createdAt }` for a fingerprint, or null.
 *  Reads the L1 map, then the SQLite alignments table, then any pre-DB
 *  `data/forced-align-cache/<fp>.json` file (promoted into the DB when
 *  found so the next read is a row lookup). */
export function readCachedAlignmentInfo(fp) {
	const hot = alignmentCache.get(fp);
	if (hot) return hot;
	let info = getAlignmentRow(fp);
	if (!info) {
		info = readLegacyAlignment(fp);
		if (info) putAlignmentRow(fp, { ...info, createdAt: Date.now() });
	}
	if (info) alignmentCache.set(fp, info);
	return info;
}

/** Line array only; kept for callers that predate the engine metadata. */
export function readCachedAlignment(fp) {
	return readCachedAlignmentInfo(fp)?.lines || null;
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

/** Runs `align.py --probe` once and remembers which engine it would pick.
 *  ws-server calls this at boot so the very first track already knows
 *  whether a frame-accurate aligner is installed. Resolves to
 *  `{ engine, precise, available }`; a failed probe means `energy`. */
export function probeAlignEngine({ spawnFn = spawn, pythonBin, force = false } = {}) {
	if (enginePromise && !force) return enginePromise;
	enginePromise = new Promise((resolve) => {
		const bin = pythonBin || process.env.LYRICS_PYTHON_BIN || 'python3';
		const fallback = { engine: 'energy', precise: false, available: ['energy'] };
		let child;
		try {
			child = spawnFn(bin, [ALIGN_SCRIPT, '--probe'], { stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			resolve(fallback);
			return;
		}
		let out = '';
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			try {
				child.kill('SIGKILL');
			} catch {
				/* already gone */
			}
			finish(fallback);
		}, PROBE_TIMEOUT_MS);
		child.stdout?.on('data', (chunk) => {
			out += chunk;
		});
		child.on('error', () => finish(fallback));
		child.on('close', () => {
			try {
				const parsed = JSON.parse(out);
				const engine = String(parsed?.engine || 'energy');
				finish({
					engine,
					precise: Boolean(parsed?.precise) || isPreciseEngine(engine),
					available: Array.isArray(parsed?.available) ? parsed.available : [engine]
				});
			} catch {
				finish(fallback);
			}
		});
	}).then((info) => {
		engineInfo = info;
		return info;
	});
	return enginePromise;
}

/** Synchronous view of the last probe (null until it has resolved).
 *  `FORCED_ALIGN_ENGINE` set explicitly short-circuits the probe. */
export function alignEngineInfo() {
	const forced = String(process.env.FORCED_ALIGN_ENGINE || '')
		.trim()
		.toLowerCase();
	if (forced && forced !== 'auto') {
		return { engine: forced, precise: isPreciseEngine(forced), available: [forced] };
	}
	return engineInfo;
}

/** Test hook. */
export function resetAlignEngineProbe() {
	enginePromise = null;
	engineInfo = null;
	alignmentCache.clear();
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

function storeAlignmentResult(fp, outJsonPath, { artist, title, duration }) {
	let data;
	try {
		data = JSON.parse(readFileSync(outJsonPath, 'utf8'));
	} catch (error) {
		console.error('forced-align produced no readable result:', error.message);
		return false;
	}
	if (!Array.isArray(data?.lines) || !data.lines.length) return false;
	const engine = String(data.engine || 'energy');
	const info = {
		lines: data.lines,
		engine,
		precise: Boolean(data.precise) || isPreciseEngine(engine),
		createdAt: Date.now()
	};
	alignmentCache.set(fp, info);
	putAlignmentRow(fp, { ...info, artist, title, duration });
	return true;
}

/** Decides whether a track should be (re)aligned given what is already
 *  cached and what the community lookup delivered. Pure, so the policy is
 *  unit-testable without spawning anything.
 *
 *  - A precise alignment on file is final.
 *  - A precise engine is installed: align every track. Community word
 *    clocks are kept on screen until the model's result lands, then the
 *    model wins (see hostData.pickDisplayLyrics).
 *  - Only `energy` is available: align only when nobody published real
 *    word clocks, and never redo an energy pass that already exists. */
export function shouldAlign({ cached, engine, communityWordLevel = false } = {}) {
	if (cached?.precise) return false;
	const precise = Boolean(engine?.precise);
	if (precise) return true;
	if (cached) return false;
	return !communityWordLevel;
}

/** Records the rest of this play-through and force-aligns known plain lyric
 *  text against it on-device. Fire-and-forget: the current poll still
 *  returns whatever online sources had, and a later poll of the same track
 *  picks up the cached word clocks from the DB. Returns the fingerprint
 *  when a result exists or a job is running, null when nothing will
 *  happen for this track. */
export function ensureAlignedLyrics({
	artist,
	title,
	duration,
	plainLyrics,
	position = 0,
	communityWordLevel = false,
	engine,
	spawnFn,
	findBinary,
	pythonBin
} = {}) {
	const dur = Number(duration) || 0;
	const fp = trackFingerprint(artist, title, dur);
	const cached = readCachedAlignmentInfo(fp);
	if (inFlight.has(fp)) return fp;
	const engineNow = engine === undefined ? alignEngineInfo() : engine;
	if (!shouldAlign({ cached, engine: engineNow, communityWordLevel })) return cached ? fp : null;
	if (!plainLyrics || !dur || dur < MIN_DURATION_SEC || dur > MAX_DURATION_SEC) return cached ? fp : null;
	if (Number(position) > START_WINDOW_SEC) return cached ? fp : null;

	inFlight.add(fp);
	const workDir = path.join(os.tmpdir(), `smart-display-align-${fp}`);
	const wavPath = path.join(workDir, 'track.wav');
	const lyricsTextPath = path.join(workDir, 'lyrics.txt');
	const outJsonPath = path.join(workDir, 'aligned.json');
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
		return cached ? fp : null;
	}

	const offsetSec = Number(position) || 0;
	const recordSec = Math.ceil(dur - offsetSec) + 2;
	const recorder = recordToWavFile({ outPath: wavPath, durationSec: recordSec, spawnFn, findBinary });
	recorders.set(fp, recorder);

	recorder.done
		.then((recorded) => {
			if (!recorded || !existsSync(wavPath)) return false;
			return runPythonAlign({ wavPath, lyricsTextPath, outJsonPath, spawnFn, pythonBin, offsetSec });
		})
		.then((ok) => {
			if (!ok) return false;
			return storeAlignmentResult(fp, outJsonPath, { artist, title, duration: dur });
		})
		.catch((error) => console.error('forced-align job failed:', error.message))
		.finally(cleanup);

	return fp;
}
