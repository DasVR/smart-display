#!/usr/bin/env node
/**
 * Play a recorded day back on a real wall build.
 *
 *   npm run build
 *   npm run replay -- 2026-10-15                 # data/log/2026-10-15.ndjson
 *   npm run replay -- wall-2026-10-15.ndjson --from 07:30 --speed 30 --loop
 *
 * Then open http://localhost:3100 (the wall) or /remote (the phone). Every
 * broadcast the server made that day arrives again in order, sped up, from
 * the state at --from (the last keyframe plus everything after it). It's a
 * demo, a fixture for checking a change against a real day, and the way to
 * reproduce "why did the wall ring at 3:12?" from a log someone sends you.
 *
 * Only the socket is replayed. /api/* answers from this machine, so
 * weather, the calendar and lyrics are today's (or missing), not the day's.
 *
 *   --from HH:MM    start here (the day's clock); default the first event
 *   --to HH:MM      stop here; default the end of the log
 *   --speed N       N× real time; default 60 (an hour a minute)
 *   --port N        default 3100
 *   --loop          start over at the end
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { parseLog, replayPlan, stateAt } from '../src/lib/eventLog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const which = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').match(/^--(from|to|speed|port)$/));
if (!which) {
	console.error('usage: npm run replay -- <YYYY-MM-DD | file.ndjson> [--from HH:MM] [--to HH:MM] [--speed 60] [--port 3100] [--loop]');
	process.exit(2);
}
const file = /^\d{4}-\d{2}-\d{2}$/.test(which) ? path.join(root, 'data/log', `${which}.ndjson`) : path.resolve(which);
if (!existsSync(file)) {
	console.error(`no recording at ${file}`);
	process.exit(1);
}
const entries = parseLog(readFileSync(file, 'utf8'));
if (!entries.length) {
	console.error(`${file} has nothing to replay`);
	process.exit(1);
}

/** "07:30" on the recording's first day, in this machine's time zone */
function clockOnDay(hhmm, fallback) {
	if (!hhmm) return fallback;
	const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
	if (!m) {
		console.error(`--from/--to take HH:MM, not ${hhmm}`);
		process.exit(2);
	}
	const d = new Date(entries[0].t);
	d.setHours(Number(m[1]), Number(m[2]), 0, 0);
	return d.getTime();
}
const from = clockOnDay(arg('from'), entries[0].t);
const to = clockOnDay(arg('to'), Infinity);
const speed = Number(arg('speed', '60')) || 60;
const port = Number(arg('port', '3100'));
const loop = flag('loop');

const handlerPath = path.join(root, 'build/handler.js');
if (!existsSync(handlerPath)) {
	console.error('no wall build: run npm run build first');
	process.exit(1);
}
const { handler } = await import(handlerPath);

const server = createServer((req, res) => handler(req, res));
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
let view = stateAt(entries, from).view || 'clock';

let timers = [];
function play() {
	timers.forEach(clearTimeout);
	const plan = replayPlan(entries, { from, to, speed });
	const last = plan.at(-1)?.delay ?? 0;
	console.log(`replaying ${plan.length} events, ${Math.round(last / 1000)} s at ${speed}×`);
	timers = plan.map(({ delay, msg }) =>
		setTimeout(() => {
			if (msg.type === 'navigate') view = msg.view;
			clients.forEach((ws) => send(ws, msg));
		}, delay)
	);
	timers.push(
		setTimeout(() => {
			if (!loop) return console.log('end of the recording');
			console.log('from the top');
			view = stateAt(entries, from).view || 'clock';
			clients.forEach((ws) => send(ws, stateAt(entries, from)));
			play();
		}, last + 1500)
	);
}

wss.on('connection', (ws) => {
	clients.add(ws);
	ws.on('close', () => clients.delete(ws));
	// state as of where the replay is now, so a late joiner isn't blank
	send(ws, { ...stateAt(entries, from), view });
	ws.on('message', (raw) => {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		if (msg.type === 'ping') send(ws, { type: 'pong' });
		// the phone can still change the view, so a replay is something to click through
		if (msg.type === 'navigate' && msg.view) {
			view = msg.view;
			clients.forEach((c) => send(c, { type: 'navigate', view, from: 'replay' }));
		}
	});
});

server.listen(port, () => {
	console.log(`replay of ${path.basename(file)} on http://localhost:${port} (phone: /remote)`);
	play();
});
