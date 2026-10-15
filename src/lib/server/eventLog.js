/**
 * Writes the wall's broadcasts to data/log/YYYY-MM-DD.ndjson (see
 * src/lib/eventLog.js for what is kept and what never is), and keeps 14 days.
 *
 *   record(msg)        a broadcast; buffered, flushed every second
 *   keyframe(state)    a full init, so a replay can start from here
 *   GET /api/log                 the days on file
 *   GET /api/log/YYYY-MM-DD      that day's file, as ndjson
 * The HTTP side answers only on the display itself (isLocal): over SSH, or
 * from the kiosk's own browser.
 *
 * Set EVENT_LOG=off to record nothing.
 */

import { appendFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { dayKey } from '../dayLog.js';
import { logLine } from '../eventLog.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createEventLog({ dir, now = () => Date.now(), keepDays = 14, flushMs = 1000, env = process.env, isLocal = () => true, log = console }) {
	const enabled = env.EVENT_LOG !== 'off';
	let buffer = [];
	let bufferDay = '';
	let timer = null;
	let lastPrunedDay = '';
	let ready = null;

	function ensureDir() {
		ready ??= mkdir(dir, { recursive: true }).catch(() => {});
		return ready;
	}

	async function prune(today) {
		if (lastPrunedDay === today) return;
		lastPrunedDay = today;
		const cutoff = dayKey(now() - keepDays * 86_400_000);
		try {
			for (const f of await readdir(dir)) {
				const day = f.replace(/\.ndjson$/, '');
				if (DAY_RE.test(day) && day < cutoff) await unlink(path.join(dir, f)).catch(() => {});
			}
		} catch {
			/* no directory yet */
		}
	}

	async function flush() {
		clearTimeout(timer);
		timer = null;
		if (!buffer.length) return;
		const lines = buffer.join('');
		const day = bufferDay;
		buffer = [];
		await ensureDir();
		try {
			await appendFile(path.join(dir, `${day}.ndjson`), lines);
		} catch (err) {
			log.error?.(`event log: could not write: ${err.message}`);
		}
		prune(day);
	}

	function push(line) {
		if (!enabled || !line) return;
		const day = dayKey(now());
		// a new day: write yesterday's lines to yesterday's file first
		if (bufferDay && day !== bufferDay) flush();
		bufferDay = day;
		buffer.push(line);
		if (!timer) timer = setTimeout(flush, flushMs);
	}

	function record(msg) {
		push(logLine(msg, now()));
	}

	function keyframe(state) {
		push(logLine({ ...state, type: 'init' }, now()));
	}

	async function days() {
		try {
			return (await readdir(dir))
				.map((f) => f.replace(/\.ndjson$/, ''))
				.filter((d) => DAY_RE.test(d))
				.sort()
				.reverse();
		} catch {
			return [];
		}
	}

	async function handleHttp(req, res) {
		if (req.method !== 'GET') return false;
		const url = new URL(req.url, 'http://local');
		const m = url.pathname.match(/^\/api\/log(?:\/([^/]+))?\/?$/);
		if (!m) return false;
		if (!isLocal(req)) {
			res.writeHead(403, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'the log is only served on the display itself' }));
			return true;
		}
		if (!m[1]) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ recording: enabled, keepDays, days: await days() }));
			return true;
		}
		if (!DAY_RE.test(m[1])) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'day must be YYYY-MM-DD' }));
			return true;
		}
		await flush();
		try {
			const text = await readFile(path.join(dir, `${m[1]}.ndjson`), 'utf8');
			res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': `attachment; filename="wall-${m[1]}.ndjson"` });
			res.end(text);
		} catch {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'nothing recorded that day' }));
		}
		return true;
	}

	return { record, keyframe, flush, days, handleHttp, enabled: () => enabled };
}
