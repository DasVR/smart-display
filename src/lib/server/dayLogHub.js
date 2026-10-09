/**
 * Keeps the day's tally (src/lib/dayLog.js) in data/daylog.json and serves
 * the end-of-day receipt:
 *
 *   GET /api/day            today's receipt
 *   GET /api/day?date=YYYY-MM-DD
 *
 * Only counts and titles are stored, a week at most. Saves are batched so
 * a run of songs doesn't write the file on every track.
 */
import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildReceipt, logEvent } from '../dayLog.js';

const SAVE_DELAY_MS = 15000;

export function createDayLogHub({ dataDir, log = console, now = () => Date.now() }) {
	const file = path.join(dataDir, 'daylog.json');
	let state = { days: {} };
	try {
		state = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		/* first run */
	}
	let saveTimer = 0;

	function save() {
		saveTimer = 0;
		try {
			mkdirSync(dataDir, { recursive: true });
			const tmp = `${file}.tmp`;
			writeFileSync(tmp, JSON.stringify(state));
			renameSync(tmp, file);
		} catch (err) {
			log.error?.(`daylog: could not save: ${err.message}`);
		}
	}

	function record(type, payload) {
		const next = logEvent(state, type, payload, now());
		if (next === state) return;
		state = next;
		if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
	}

	function receipt(date) {
		return buildReceipt(state, { now: now(), date: date || undefined });
	}

	async function handleHttp(req, res) {
		if (req.method !== 'GET') return false;
		const url = new URL(req.url, 'http://local');
		if (url.pathname !== '/api/day') return false;
		const date = url.searchParams.get('date');
		const body = date && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? { error: 'date must be YYYY-MM-DD' } : receipt(date);
		res.writeHead(body.error ? 400 : 200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(body));
		return true;
	}

	function flush() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			save();
		}
	}

	return { record, receipt, handleHttp, flush, state: () => state };
}
