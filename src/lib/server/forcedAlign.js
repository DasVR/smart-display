import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordToWavFile } from './audioCapture.js';
import { normalizeLyricText } from './lyrics.js';
import {
	getAlignmentRow,
	getRecordingRow,
	listLyricsForAlign,
	putAlignmentRow,
	putRecordingRow
} from './lyricsStore.js';

const ALIGN_SCRIPT = fileURLToPath(new URL('../../../scripts/forced_align/align.py', import.meta.url));

function legacyCacheDir() {
	return process.env.FORCED_ALIGN_CACHE_DIR || path.join(process.cwd(), 'data', 'forced-align-cache');
}

function audioDir() {
	return process.env.FORCED_ALIGN_AUDIO_DIR || path.join(process.cwd(), 'data', 'forced-align-audio');
}

function audioPath(fp) {
	return path.join(audioDir(), `${fp}.wav`);
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

/** How usable a word-clock file is. Community karaoke and a model pass
 *  are scored the same way so the display can keep whichever actually
 *  locks to the song: monotonic word starts, few collapsed timestamps,
 *  real end times, and a span that covers a sensible slice of the track. */
export function alignmentQuality(lines, { duration = 0 } = {}) {
	if (!Array.isArray(lines) || !lines.length) return 0;
	const words = [];
	for (const line of lines) {
		for (const word of line?.words || []) {
			if (!word || word.estimated) continue;
			const time = Number(word.time);
			if (!Number.isFinite(time)) continue;
			const end = Number(word.end);
			words.push({ time, end: Number.isFinite(end) ? end : null });
		}
	}
	if (words.length < 2) return 0;
	let increasing = 0;
	let collapsed = 0;
	let withEnd = 0;
	for (let i = 0; i < words.length; i++) {
		if (words[i].end != null && words[i].end > words[i].time) withEnd += 1;
		if (i === 0) continue;
		if (words[i].time > words[i - 1].time) increasing += 1;
		else if (words[i].time === words[i - 1].time) collapsed += 1;
	}
	const pairs = words.length - 1;
	const last = words[words.length - 1];
	const span = (last.end ?? last.time) - words[0].time;
	let score = 10;
	score += (increasing / pairs) * 40;
	score += (1 - collapsed / pairs) * 20;
	score += (withEnd / words.length) * 15;
	const dur = Number(duration) || 0;
	if (dur >= 20 && span > 0) {
		const cover = span / dur;
		if (cover >= 0.3 && cover <= 1.1) score += 15;
		else score += Math.max(0, 15 - Math.abs(cover - 0.65) * 25);
	}
	return score;
}

/** True when `candidate` is clearly a tighter lock than `baseline`. */
export function isBetterAlignment(candidate, baseline, duration = 0) {
	return alignmentQuality(candidate, { duration }) > alignmentQuality(baseline, { duration }) + 1;
}

function liveRecording(fp) {
	const row = getRecordingRow(fp);
	if (row && row.path && existsSync(row.path)) return row;
	return null;
}

function persistRecording(fp, srcPath, { offsetSec = 0, duration = 0 } = {}) {
	if (!srcPath || !existsSync(srcPath)) return null;
	const existing = getRecordingRow(fp);
	if (existing && existsSync(existing.path) && Number(existing.offsetSec) <= Number(offsetSec || 0)) {
		return existing;
	}
	const dest = audioPath(fp);
	try {
		mkdirSync(audioDir(), { recursive: true });
		if (path.resolve(srcPath) !== path.resolve(dest)) copyFileSync(srcPath, dest);
	} catch (error) {
		console.error('forced-align persist recording failed:', error.message);
		return existing && existsSync(existing.path) ? existing : null;
	}
	if (!existsSync(dest)) return existing && existsSync(existing.path) ? existing : null;
	const row = { path: dest, offsetSec: Number(offsetSec) || 0, durationSec: Number(duration) || 0, createdAt: Date.now() };
	putRecordingRow(fp, row);
	return row;
}

const alignQueue = [];
let alignBusy = false;

function enqueueAlign({
	fp,
	wavPath,
	offsetSec = 0,
	plainLyrics,
	artist,
	title,
	duration,
	spawnFn,
	pythonBin
}) {
	if (!fp || !wavPath || !plainLyrics) return;
	if (alignQueue.some((job) => job.fp === fp) || (alignBusy && alignBusy.fp === fp)) return;
	inFlight.add(fp);
	alignQueue.push({ fp, wavPath, offsetSec, plainLyrics, artist, title, duration, spawnFn, pythonBin });
	pumpAlignQueue();
}

function pumpAlignQueue() {
	if (alignBusy) return;
	const job = alignQueue.shift();
	if (!job) return;
	alignBusy = job;
	const workDir = path.join(os.tmpdir(), `smart-display-align-job-${job.fp}`);
	const lyricsTextPath = path.join(workDir, 'lyrics.txt');
	const outJsonPath = path.join(workDir, 'aligned.json');
	Promise.resolve()
		.then(() => {
			mkdirSync(workDir, { recursive: true });
			writeFileSync(lyricsTextPath, job.plainLyrics);
			return runPythonAlign({
				wavPath: job.wavPath,
				lyricsTextPath,
				outJsonPath,
				spawnFn: job.spawnFn,
				pythonBin: job.pythonBin,
				offsetSec: job.offsetSec
			});
		})
		.then((ok) => {
			if (!ok) return false;
			return storeAlignmentResult(job.fp, outJsonPath, {
				artist: job.artist,
				title: job.title,
				duration: job.duration
			});
		})
		.catch((error) => console.error('forced-align job failed:', error.message))
		.finally(() => {
			inFlight.delete(job.fp);
			try {
				rmSync(workDir, { recursive: true, force: true });
			} catch {
				/* best effort */
			}
			alignBusy = false;
			pumpAlignQueue();
		});
}

/** Decides whether a track should be (re)aligned given what is already
 *  cached and what the community lookup delivered. Pure, so the policy is
 *  unit-testable without spawning anything.
 *
 *  - Same precise engine already on file: done.
 *  - A better precise engine is installed: redo from the saved WAV.
 *  - A precise engine is installed with no result yet: align.
 *  - Only `energy` is available: align only when nobody published real
 *    word clocks, and never redo an energy pass that already exists. */
export function shouldAlign({ cached, engine, communityWordLevel = false } = {}) {
	const name = String(engine?.engine || '').toLowerCase();
	const precise = Boolean(engine?.precise) || isPreciseEngine(name);
	const cachedEngine = String(cached?.engine || '').toLowerCase();
	if (cached?.precise && (!precise || (name && name === cachedEngine))) return false;
	if (precise) return true;
	if (cached) return false;
	return !communityWordLevel;
}

/** Walk every cached lyric that already has a speaker recording and queue
 *  an alignment with the current engine. Tracks with no WAV wait until
 *  they play: there is no local music library to pull from. */
export function sweepCachedLyrics({ engine, spawnFn, pythonBin } = {}) {
	const engineNow = engine === undefined ? alignEngineInfo() : engine;
	const rows = listLyricsForAlign();
	let queued = 0;
	let haveAudio = 0;
	for (const row of rows) {
		const fp = trackFingerprint(row.artist, row.title, row.duration);
		const rec = liveRecording(fp);
		if (!rec) continue;
		haveAudio += 1;
		const cached = readCachedAlignmentInfo(fp);
		if (!shouldAlign({ cached, engine: engineNow, communityWordLevel: row.wordLevel })) continue;
		if (inFlight.has(fp)) continue;
		enqueueAlign({
			fp,
			wavPath: rec.path,
			offsetSec: rec.offsetSec,
			plainLyrics: row.plainText,
			artist: row.artist,
			title: row.title,
			duration: row.duration,
			spawnFn,
			pythonBin
		});
		queued += 1;
	}
	return { queued, haveAudio, cached: rows.length };
}

/** Records the rest of this play-through (or reuses a saved WAV) and
 *  force-aligns known plain lyric text against it on-device. Fire-and-forget:
 *  the current poll still returns whatever online sources had, and a later
 *  poll of the same track picks up the cached word clocks from the DB. */
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

	const existing = liveRecording(fp);
	if (existing) {
		enqueueAlign({
			fp,
			wavPath: existing.path,
			offsetSec: existing.offsetSec,
			plainLyrics,
			artist,
			title,
			duration: dur,
			spawnFn,
			pythonBin
		});
		return fp;
	}

	if (Number(position) > START_WINDOW_SEC) return cached ? fp : null;

	inFlight.add(fp);
	const workDir = path.join(os.tmpdir(), `smart-display-align-${fp}`);
	const wavPath = path.join(workDir, 'track.wav');
	const cleanupWork = () => {
		try {
			rmSync(workDir, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	};

	try {
		mkdirSync(workDir, { recursive: true });
	} catch (error) {
		console.error('forced-align setup failed:', error.message);
		inFlight.delete(fp);
		return cached ? fp : null;
	}

	const offsetSec = Number(position) || 0;
	const recordSec = Math.ceil(dur - offsetSec) + 2;
	const recorder = recordToWavFile({ outPath: wavPath, durationSec: recordSec, spawnFn, findBinary });
	recorders.set(fp, recorder);

	recorder.done
		.then((recorded) => {
			recorders.delete(fp);
			if (!recorded || !existsSync(wavPath)) {
				inFlight.delete(fp);
				cleanupWork();
				return;
			}
			const saved = persistRecording(fp, wavPath, { offsetSec, duration: dur });
			cleanupWork();
			inFlight.delete(fp);
			if (!saved?.path || !existsSync(saved.path)) return;
			enqueueAlign({
				fp,
				wavPath: saved.path,
				offsetSec: saved.offsetSec ?? offsetSec,
				plainLyrics,
				artist,
				title,
				duration: dur,
				spawnFn,
				pythonBin
			});
		})
		.catch((error) => {
			console.error('forced-align job failed:', error.message);
			recorders.delete(fp);
			inFlight.delete(fp);
			cleanupWork();
		});

	return fp;
}
