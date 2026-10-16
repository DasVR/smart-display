/**
 * The wall's senses, server side: what the webcam process (senses/, Python)
 * reports, and what the wall does with it.
 *
 *   POST /api/senses/state       the process's heartbeat: { camera, mic }. Answers
 *                                with its settings, how long to keep its ears shut
 *                                (the wall is talking), notes on or off, and a
 *                                calibration to run
 *   POST /api/senses/heard       { kind: 'command' | 'note' | 'wake', text }
 *   POST /api/senses/calibrated  { id, focalPx, focalWidth } or { id, error }
 *   POST /api/senses/report      { id, rows }: the process's last 30 s of decisions,
 *                                sent when the phone says "that was wrong"
 *   GET  /api/senses             the same snapshot the phone gets
 *   GET  /api/senses/notes       saved notes (file names, newest first)
 *   GET  /api/senses/notes/<f>   one saved note, as text
 *
 * The three POSTs are taken only from this machine (the process runs here);
 * GET needs the /api bearer token like the rest, unless it is local too.
 *
 * Only numbers and words arrive: how many people, how far, where across the
 * room, whether anything moved, and what was said to the wall. Pictures and
 * sound never leave the process. Notes are the exception that's kept on
 * purpose: when you ask the wall to take notes, what it hears is written to
 * data/transcripts/ as text when the notes stop. "That was wrong" reports
 * are kept too (data/senses-reports/, numbers and words): what the camera
 * counted and the microphone made of things in the 30 seconds before the
 * phone's tap, to find out why it got something wrong.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { MAX_ZONES, hushMsFor, newPlaceState, normalizeSensesSettings, notesCommand, placeStep, presenceChanged, presenceFrom, transcriptText } from '../senses.js';
import { authorized, loadApiToken } from './taskService.js';

const OFFLINE_MS = 5000;
const FOLLOW_MS = 6000;
const SPEAK_START_MS = 2500;
const CALIBRATE_TTL_MS = 20000;
const MAX_BODY = 8 * 1024;
const MAX_REPORT_BODY = 128 * 1024;
const MAX_LINES = 400;
const REPORT_WAIT_MS = 10000;
const KEEP_REPORTS = 50;
const HISTORY_MS = 30000;
const REPORT_NAME = /^report-[\w-]+\.json$/;

function readBody(req, max = MAX_BODY) {
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (c) => {
			raw += c;
			if (raw.length > max) {
				reject(Object.assign(new Error('body too large'), { status: 413 }));
				req.destroy();
			}
		});
		req.on('end', () => {
			try {
				const v = raw.trim() ? JSON.parse(raw) : {};
				resolve(v && typeof v === 'object' ? v : {});
			} catch {
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

function readJson(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

function writeJsonAtomic(file, data) {
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2));
	renameSync(tmp, file);
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {(msg: object) => void} o.broadcast
 * @param {(text: string) => Promise<object|null>} o.command  "tell the wall": answers { say }
 * @param {(text: string) => Promise<unknown>} o.say          speak on the wall
 * @param {(req: import('http').IncomingMessage) => boolean} o.isLocal
 * @param {(presence: object) => void} [o.onNear]             someone just came up to the wall
 * @param {(presence: object, before: object) => void} [o.onPresence]  any change worth telling
 * @param {(action: object) => void} [o.onPlace]   a spot asks for a view, or the panel off (placeStep)
 * @param {() => boolean} [o.isQuiet]              night (quiet hours) right now
 */
export function createSensesHub({ dataDir, broadcast, command, say, isLocal, onNear = () => {}, onPresence = () => {}, onPlace = () => {}, isQuiet = () => false, now = () => Date.now(), env = process.env, timeZone, log = console.log }) {
	const settingsFile = path.join(dataDir, 'senses.json');
	const transcriptDir = path.join(dataDir, 'transcripts');
	const reportDir = path.join(dataDir, 'senses-reports');
	const tokenFile = path.join(dataDir, 'api-token');
	let settings = normalizeSensesSettings(readJson(settingsFile, {}));
	let lastSeen = 0;
	let camera = {};
	let mic = {};
	let presence = presenceFrom(null, settings, false);
	let hushUntil = 0;
	// after the wall asks something back, the next thing said is the answer:
	// the ears stay open without "hey wall" for FOLLOW_MS once it stops talking
	let followAt = 0;
	let calibration = null; // { id, meters, at }
	let calibrated = null; // the last result, for the phone
	let notes = { on: false, startedAt: null, lastAt: null, lines: [] };
	let seq = 0;
	let lastMicState = 'idle';
	const placeState = newPlaceState();
	// the wall's side of a report: what presence it was told, the last 30 s
	let history = [];
	let reportJob = null; // { id, note, at, history }
	let reported = null; // { ok, name } for the phone

	const online = () => now() - lastSeen < OFFLINE_MS;

	function snapshot() {
		return {
			settings,
			online: online(),
			camera: online() ? camera : { ok: false },
			mic: online() ? mic : { ok: false },
			presence,
			calibrating: Boolean(calibration),
			calibrated,
			reporting: Boolean(reportJob),
			reported,
			notes: { on: notes.on, startedAt: notes.startedAt, count: notes.lines.length, lines: notes.lines.slice(-30) }
		};
	}

	const tell = () => broadcast({ type: 'senses', ...snapshot() });

	function setSettings(patch) {
		settings = normalizeSensesSettings(patch, settings);
		writeJsonAtomic(settingsFile, settings);
		if (!settings.mic && notes.on) stopNotes();
		tell();
		return snapshot();
	}

	/* ---------- presence ---------- */

	function updatePresence() {
		const next = presenceFrom(camera, settings, online() && settings.camera, presence.near);
		if (!presenceChanged(presence, next)) return;
		const before = presence;
		presence = next;
		history = [...history.filter((h) => now() - h.t < HISTORY_MS), { t: now(), ...presence }];
		broadcast({ type: 'presence', ...presence });
		if (presence.near && !before.near) onNear(presence);
		onPresence(presence, before);
		runPlaces();
	}

	/** What the spots ask for: a view where you settle, the screen off when you sleep or leave. */
	function runPlaces() {
		let actions = [];
		try {
			actions = placeStep(placeState, { presence, settings, now: now(), quiet: isQuiet() });
		} catch (e) {
			log(`senses: places: ${e.message}`);
		}
		for (const a of actions) {
			try {
				onPlace(a);
			} catch (e) {
				log(`senses: places: ${e.message}`);
			}
		}
	}

	/** Someone changed the page by hand: the spots leave it alone for a while. */
	function noteManual() {
		placeState.manualAt = now();
	}

	/* ---------- notes ---------- */

	function startNotes() {
		if (!notes.on) notes = { on: true, startedAt: new Date(now()).toISOString(), lastAt: now(), lines: [] };
		broadcast({ type: 'transcript', on: true, startedAt: notes.startedAt });
		tell();
		return snapshot().notes;
	}

	function stopNotes() {
		if (!notes.on) return { saved: null };
		let saved = null;
		if (notes.lines.length) {
			const stamp = notes.startedAt.replace(/[:]/g, '-').replace(/\..*$/, '');
			saved = `${stamp}.txt`;
			try {
				mkdirSync(transcriptDir, { recursive: true });
				writeFileSync(path.join(transcriptDir, saved), transcriptText(notes.lines, { timeZone }), { mode: 0o600 });
			} catch (e) {
				log(`senses: couldn't save notes: ${e.message}`);
				saved = null;
			}
		}
		notes = { ...notes, on: false };
		broadcast({ type: 'transcript', on: false, saved });
		tell();
		return { saved };
	}

	function addNote(text) {
		const line = { id: ++seq, at: new Date(now()).toISOString(), text: String(text).slice(0, 2000) };
		notes.lines = [...notes.lines, line].slice(-MAX_LINES);
		notes.lastAt = now();
		broadcast({ type: 'transcript', on: true, line });
	}

	function savedTranscripts() {
		try {
			return readdirSync(transcriptDir)
				.filter((f) => /^[\w-]+\.txt$/.test(f))
				.sort()
				.reverse()
				.slice(0, 20);
		} catch {
			return [];
		}
	}

	function readTranscript(name) {
		if (!/^[\w-]+\.txt$/.test(String(name))) return null;
		try {
			return readFileSync(path.join(transcriptDir, name), 'utf8');
		} catch {
			return null;
		}
	}

	/* ---------- what was heard ---------- */

	async function heard(kind, text) {
		const words = String(text || '').trim().slice(0, 500);
		if (kind === 'wake') {
			broadcast({ type: 'heard', listening: true });
			return { ok: true };
		}
		if (kind === 'note') {
			if (notes.on && words) addNote(words);
			return { ok: notes.on };
		}
		if (kind !== 'command' || !words) return { ok: false, error: 'empty' };
		followAt = 0;
		// what you said goes on the island; the answer is spoken (and captioned) by the voice
		if (settings.captions) broadcast({ type: 'heard', text: words });
		const notesOp = notesCommand(words);
		let reply;
		if (notesOp === 'start') {
			startNotes();
			reply = "Taking notes. Say 'hey wall, stop taking notes' when you're done.";
		} else if (notesOp === 'stop') {
			const was = notes.lines.length;
			stopNotes();
			reply = was ? `Stopped. ${was} ${was === 1 ? 'line' : 'lines'} saved; they're on your phone.` : 'Stopped. Nothing was said, so nothing was saved.';
		} else {
			let result = null;
			try {
				result = await command(words);
			} catch (e) {
				log(`senses: command failed: ${e.message}`);
			}
			reply = result?.say || result?.error || "Sorry, I didn't catch that.";
			if (result?.followUp || result?.asking) followAt = now();
		}
		await Promise.resolve(say(reply)).catch(() => {});
		return { ok: true, say: reply };
	}

	/* ---------- calibrating distance ---------- */

	/**
	 * A measurement the webcam process makes for the phone:
	 *   { kind: 'face', meters }            stand this far away, facing it
	 *   { kind: 'zone', name }              remember where you are now as a spot
	 *   { kind: 'paper', paper, wallMeters } find the sheet on the floor and map it
	 */
	function calibrate(job = {}) {
		const kind = ['face', 'zone', 'paper'].includes(job.kind) ? job.kind : 'face';
		if (!online() || !settings.camera) return { ok: false, error: 'camera-off' };
		let detail;
		if (kind === 'face') {
			const m = Number(job.meters);
			if (!Number.isFinite(m) || m < 0.3 || m > 5) return { ok: false, error: 'bad-distance' };
			detail = { meters: m };
		} else if (kind === 'zone') {
			const name = String(job.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
			if (!name) return { ok: false, error: 'no-name' };
			const known = settings.zones.some((z) => z.name.toLowerCase() === name.toLowerCase());
			if (!known && settings.zones.length >= MAX_ZONES) return { ok: false, error: 'too-many-zones' };
			detail = { name };
		} else {
			const wall = job.wallMeters === '' || job.wallMeters == null ? null : Number(job.wallMeters);
			if (wall != null && (!Number.isFinite(wall) || wall < 0 || wall > 10)) return { ok: false, error: 'bad-distance' };
			detail = { paper: job.paper === 'a4' ? 'a4' : 'letter', wallMeters: wall };
		}
		calibration = { id: `cal-${++seq}`, kind, ...detail, at: now() };
		calibrated = null;
		tell();
		return { ok: true, id: calibration.id, kind };
	}

	function calibrationDone(body) {
		if (!calibration || body.id !== calibration.id) return;
		const job = calibration;
		calibration = null;
		const fail = (error) => {
			calibrated = { ok: false, kind: job.kind, error, at: now() };
			tell();
		};
		if (body.error) return fail(['no-face', 'no-person', 'no-paper'].includes(body.error) ? body.error : 'failed');
		if (job.kind === 'zone') {
			const sig = Array.isArray(body.sig) ? body.sig.map(Number) : null;
			if (!sig || sig.length !== 4 || !sig.every(Number.isFinite)) return fail('no-person');
			const zones = settings.zones.filter((z) => z.name.toLowerCase() !== job.name.toLowerCase());
			calibrated = { ok: true, kind: 'zone', name: job.name, at: now() };
			setSettings({ zones: [...zones, { name: job.name, sig }] });
			return;
		}
		if (job.kind === 'paper') {
			// check it first: a bad answer must not wipe a floor that was mapped before
			const next = normalizeSensesSettings({ floorMap: body.floorMap, floorQuad: body.quad }, settings);
			if (!next.floorMap) return fail('no-paper');
			calibrated = { ok: true, kind: 'paper', at: now() };
			setSettings({ floorMap: next.floorMap, floorQuad: next.floorQuad, paper: job.paper, paperWall: job.wallMeters });
			return;
		}
		const focal = Number(body.focalPx);
		if (!Number.isFinite(focal) || focal <= 0) return fail('failed');
		calibrated = { ok: true, kind: 'face', meters: job.meters, samples: Number(body.samples) || 0, at: now() };
		setSettings({ focalPx: focal, focalWidth: Number(body.focalWidth) || null });
	}

	/* ---------- "that was wrong" ---------- */

	/** The phone's tap: ask the webcam process for its last 30 s (or save the wall's side alone). */
	function startReport(note) {
		if (reportJob) return { ok: false, error: 'busy' };
		reportJob = {
			id: `rep-${++seq}`,
			note: String(note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300),
			at: now(),
			history: history.filter((h) => now() - h.t < HISTORY_MS)
		};
		const id = reportJob.id;
		reported = null;
		if (!online()) finishReport(null, 'senses-offline');
		else tell();
		return { ok: true, id };
	}

	function finishReport(rows, error) {
		const job = reportJob;
		if (!job) return;
		reportJob = null;
		const stamp = new Date(job.at).toISOString().replace(/[:]/g, '-').replace(/\..*$/, '');
		const name = `report-${stamp}-${job.id.replace(/\D/g, '')}.json`;
		const doc = {
			at: new Date(job.at).toISOString(),
			note: job.note,
			// numbers and words only, like everything else here
			settings: (({ floorQuad, ...rest }) => rest)(settings),
			presence: job.history.map(({ t, ...p }) => ({ secondsBefore: Math.round((job.at - t) / 100) / 10, ...p })),
			process: Array.isArray(rows) ? rows.slice(-2000).filter((r) => r && typeof r === 'object') : null,
			...(error ? { error } : {})
		};
		try {
			mkdirSync(reportDir, { recursive: true });
			writeFileSync(path.join(reportDir, name), JSON.stringify(doc, null, 2), { mode: 0o600 });
			for (const old of savedReports(1000).slice(KEEP_REPORTS)) unlinkSync(path.join(reportDir, old));
			reported = { ok: true, name, error: error || null, at: now() };
		} catch (e) {
			log(`senses: couldn't save a report: ${e.message}`);
			reported = { ok: false, error: 'unwritable', at: now() };
		}
		tell();
	}

	function savedReports(limit = 20) {
		try {
			return readdirSync(reportDir)
				.filter((f) => REPORT_NAME.test(f))
				.sort()
				.reverse()
				.slice(0, limit);
		} catch {
			return [];
		}
	}

	function readReport(name) {
		if (!REPORT_NAME.test(String(name))) return null;
		try {
			return readFileSync(path.join(reportDir, name), 'utf8');
		} catch {
			return null;
		}
	}

	/** How much longer the ears stay open for an answer, from now (0: not waiting).
	 *  The window starts when the wall stops talking; the spoken reply may not
	 *  have started yet, so it waits up to SPEAK_START_MS for it. */
	function followMs() {
		if (!followAt) return 0;
		const end = Math.max(hushUntil, followAt + SPEAK_START_MS) + FOLLOW_MS;
		const left = end - now();
		if (left <= 0) followAt = 0;
		return Math.max(0, left);
	}

	/** Ears shut while the wall talks, so it never answers itself. */
	function noteSpeaking(text) {
		hushUntil = Math.max(hushUntil, now() + hushMsFor(text));
	}

	/** Every so often: notes left on with nothing said, a calibration that never came back, the process gone. */
	let wasOnline = false;
	function tick() {
		// the sign on the wall must not say "on" after the webcam process has gone
		if (online() !== wasOnline) {
			wasOnline = online();
			tell();
		}
		if (notes.on && now() - notes.lastAt > settings.notesMinutes * 60000) stopNotes();
		if (calibration && now() - calibration.at > CALIBRATE_TTL_MS) {
			calibration = null;
			calibrated = { ok: false, error: 'timeout', at: now() };
			tell();
		}
		if (reportJob && now() - reportJob.at > REPORT_WAIT_MS) finishReport(null, 'no-answer');
		if (presence.camera && !online()) updatePresence();
		// dwell and away are about time passing, not only about changes
		runPlaces();
	}

	/* ---------- HTTP ---------- */

	function json(res, data, status = 200) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	}

	async function handleHttp(req, res) {
		const p = new URL(req.url || '/', 'http://local').pathname;
		if (p !== '/api/senses' && !p.startsWith('/api/senses/')) return false;
		const local = isLocal(req);
		try {
			if (req.method === 'GET') {
				if (!local && !authorized(req.headers, loadApiToken(tokenFile, env))) return json(res, { error: 'unauthorized' }, 401), true;
				if (p === '/api/senses') return json(res, snapshot()), true;
				// saved notes, for an assistant (scripts/tasks-mcp.mjs) as much as the phone
				if (p === '/api/senses/notes') return json(res, { notes: savedTranscripts() }), true;
				if (p.startsWith('/api/senses/notes/')) {
					const textOut = readTranscript(decodeURIComponent(p.slice('/api/senses/notes/'.length)));
					if (textOut == null) return json(res, { error: 'not found' }, 404), true;
					res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
					res.end(textOut);
					return true;
				}
				return json(res, { error: 'not found' }, 404), true;
			}
			if (req.method !== 'POST') return json(res, { error: 'method not allowed' }, 405), true;
			// the webcam process runs on this machine; nobody else reports senses
			if (!local) return json(res, { error: 'local only' }, 403), true;
			const body = await readBody(req, p === '/api/senses/report' ? MAX_REPORT_BODY : MAX_BODY);
			if (p === '/api/senses/state') {
				const wasOnline = online();
				lastSeen = now();
				camera = body.camera && typeof body.camera === 'object' ? body.camera : {};
				mic = body.mic && typeof body.mic === 'object' ? body.mic : {};
				updatePresence();
				if (!wasOnline) {
					log('senses: the webcam process is here');
					tell();
				}
				const micState = mic.state || 'idle';
				if (micState !== lastMicState) {
					lastMicState = micState;
					broadcast({ type: 'listening', state: micState });
				}
				return (
					json(res, {
						settings,
						hushMs: Math.max(0, hushUntil - now()),
						listenMs: followMs(),
						notes: notes.on,
						calibrate: calibration ? (({ at, ...job }) => job)(calibration) : null,
						report: reportJob ? reportJob.id : null
					}),
					true
				);
			}
			if (p === '/api/senses/heard') return json(res, await heard(String(body.kind || ''), body.text)), true;
			if (p === '/api/senses/report') {
				if (reportJob && body.id === reportJob.id) finishReport(body.rows);
				return json(res, { ok: true }), true;
			}
			if (p === '/api/senses/calibrated') {
				calibrationDone(body);
				return json(res, { ok: true }), true;
			}
			return json(res, { error: 'not found' }, 404), true;
		} catch (e) {
			return json(res, { error: e.message }, e.status || 500), true;
		}
	}

	/* ---------- the phone ---------- */

	/** { op: 'get' | 'set' | 'calibrate' | 'notes-start' | 'notes-stop' | 'transcripts' | 'transcript' } */
	function handleWs(msg, { mayChange = true } = {}) {
		const op = msg?.op || 'get';
		if (op === 'get') return { senses: snapshot() };
		if (op === 'transcripts') return { transcripts: savedTranscripts() };
		if (op === 'reports') return { reports: savedReports() };
		if (op === 'report-read') {
			const textOut = readReport(msg.name);
			return textOut == null ? { result: { ok: false, error: 'not-found', op } } : { report: { name: msg.name, text: textOut } };
		}
		if (!mayChange) return { senses: snapshot(), result: { ok: false, error: 'not-paired', op } };
		if (op === 'set' && msg.patch && typeof msg.patch === 'object') {
			// calibration is measured, not typed; the phone may only clear it
			const patch = { ...msg.patch };
			for (const k of ['focalPx', 'focalWidth', 'zones', 'floorMap', 'floorQuad']) delete patch[k];
			if (msg.patch.focalPx === null) Object.assign(patch, { focalPx: null, focalWidth: null });
			if (msg.patch.floorMap === null) Object.assign(patch, { floorMap: null, floorQuad: null });
			return { senses: setSettings(patch) };
		}
		if (op === 'calibrate') return { senses: snapshot(), result: { ...calibrate({ kind: 'face', meters: msg.meters }), op } };
		// remember where you are now as a spot ("bed", "desk"), or forget one
		if (op === 'remember') return { senses: snapshot(), result: { ...calibrate({ kind: 'zone', name: msg.name }), op } };
		if (op === 'forget-zone') {
			const name = String(msg.name || '').toLowerCase();
			return { senses: setSettings({ zones: settings.zones.filter((z) => z.name.toLowerCase() !== name) }), result: { ok: true, op } };
		}
		// map the floor from a sheet of paper lying on it
		if (op === 'find-paper') return { senses: snapshot(), result: { ...calibrate({ kind: 'paper', paper: msg.paper, wallMeters: msg.wallMeters }), op } };
		if (op === 'notes-start') {
			if (!settings.mic) return { senses: snapshot(), result: { ok: false, error: 'mic-off', op } };
			startNotes();
			return { senses: snapshot(), result: { ok: true, op } };
		}
		// "that was wrong": keep the last 30 s of what the senses decided
		if (op === 'report') return { senses: snapshot(), result: { ...startReport(msg.note), op } };
		if (op === 'notes-stop') return { senses: snapshot(), result: { ok: true, op, ...stopNotes() } };
		if (op === 'transcript') {
			const textOut = readTranscript(msg.name);
			return textOut == null ? { result: { ok: false, error: 'not-found', op } } : { transcript: { name: msg.name, text: textOut } };
		}
		return { senses: snapshot() };
	}

	return { snapshot, setSettings, heard, calibrate, noteSpeaking, tick, handleHttp, handleWs, startNotes, stopNotes, noteManual, startReport, presence: () => presence };
}
