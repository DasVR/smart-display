/**
 * The last few times the wall came on (src/lib/bootTimeline.js).
 *
 *   POST /api/boot   the wall's page, once it's awake: { kiosk, reached, page, awake } (local only)
 *   GET  /api/boot   { boots: [newest first], lines: the newest as text }
 *
 * The server adds its own marks: when the system and this process started,
 * and when it began answering. Kept in data/boot-times.json (last 10).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import path from 'node:path';
import { bootRecord, describeBoot } from '../bootTimeline.js';

const KEEP = 10;
export const SAME_BOOT_MS = 10 * 60000;

export function createBootLog({ dataDir, isLocal = () => true, now = () => Date.now(), systemUptime = () => uptime(), processUptime = () => process.uptime(), log = console.log }) {
	const file = path.join(dataDir, 'boot-times.json');
	const own = {
		power: Math.round(now() - systemUptime() * 1000),
		server: Math.round(now() - processUptime() * 1000),
		listening: 0
	};

	function read() {
		try {
			const list = JSON.parse(readFileSync(file, 'utf8'));
			return Array.isArray(list) ? list : [];
		} catch {
			return [];
		}
	}

	/** The server began answering. */
	function listening() {
		own.listening = now();
	}

	function record(marks = {}) {
		const pageMarks = { kiosk: marks.kiosk, reached: marks.reached, page: marks.page, awake: marks.awake };
		// the server's own marks belong to this boot only if the browser came up with it,
		// not when the kiosk alone was restarted hours later
		const sameBoot = Boolean(marks.kiosk && own.listening && Math.abs(marks.kiosk - own.listening) < SAME_BOOT_MS);
		const rec = bootRecord({ ...pageMarks, ...(sameBoot ? own : {}) }, now());
		if (marks.kiosk && !sameBoot) rec.kind = 'kiosk';
		const boots = [rec, ...read()].slice(0, KEEP);
		try {
			mkdirSync(dataDir, { recursive: true });
			writeFileSync(file, JSON.stringify(boots, null, 1));
		} catch (e) {
			log(`boot log: ${e.message}`);
		}
		if (rec.kind === 'boot') log(`boot: ${describeBoot(rec).at(-1)}`);
		return rec;
	}

	function json(res, data, status = 200) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	}

	async function handleHttp(req, res) {
		const p = new URL(req.url || '/', 'http://local').pathname;
		if (p !== '/api/boot') return false;
		if (req.method === 'GET') {
			const boots = read();
			return json(res, { boots, lines: boots[0] ? describeBoot(boots[0]) : [] }), true;
		}
		if (req.method !== 'POST') return json(res, { error: 'method' }, 405), true;
		if (!isLocal(req)) return json(res, { error: 'only the wall itself' }, 403), true;
		let raw = '';
		for await (const chunk of req) {
			raw += chunk;
			if (raw.length > 4096) return json(res, { error: 'too large' }, 413), true;
		}
		let marks;
		try {
			marks = JSON.parse(raw || '{}');
		} catch {
			return json(res, { error: 'invalid json' }, 400), true;
		}
		return json(res, { ok: true, boot: record(marks) }), true;
	}

	return { listening, record, read, handleHttp };
}
