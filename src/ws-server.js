import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handler } from '../build/handler.js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import os from 'os';

const port = process.env.PORT || 3000;

function run(cmd) {
	try { return execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim(); } catch { return null; }
}

async function getTelemetry() {
	const total = os.totalmem() / 1024 / 1024 / 1024;
	const free = os.freemem() / 1024 / 1024 / 1024;
	const used = total - free;
	const load = os.loadavg()[0];
	const cpus = os.cpus().length;
	const cpuPct = Math.min(100, Math.round((load / cpus) * 100));

	async function check(url, name, uptime = '99.9%') {
		try {
			const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
			return { name, status: r.ok, uptime };
		} catch {
			return { name, status: false, uptime: 'down' };
		}
	}

	const services = await Promise.all([
		check('https://dasdev.net', 'dasdev.net', '99.9%'),
		check('http://localhost:8123', 'home assistant', '100%'),
		check('http://localhost:3000', 'display', '100%')
	]);

	const containers = run('docker ps -q 2>/dev/null | wc -l') || '0';

	return {
		services,
		stats: {
			ram_used: Math.round(used),
			ram_total: Math.round(total),
			cpu: cpuPct,
			containers: parseInt(containers, 10)
		}
	};
}

async function getCalendar(days = 3) {
	try {
		const tokenPath = '/home/das/.hermes/google_token.json';
		const raw = readFileSync(tokenPath, 'utf8');
		const token = JSON.parse(raw);
		const now = new Date();
		const end = new Date();
		end.setDate(now.getDate() + parseInt(days, 10));
		const timeMin = now.toISOString();
		const timeMax = end.toISOString();
		const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`;
		const r = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token || token.token}` } });
		if (!r.ok) throw new Error(`calendar ${r.status}`);
		const d = await r.json();
		const events = (d.items || []).map(e => ({
			id: e.id,
			title: e.summary || '(no title)',
			start: e.start?.dateTime || e.start?.date,
			end: e.end?.dateTime || e.end?.date,
			location: e.location || ''
		}));
		return { events };
	} catch (e) {
		console.error('calendar error:', e.message);
		return { events: [] };
	}
}

function getNowPlaying() {
	try {
		const status = run('playerctl status 2>/dev/null') || 'Not available';
		if (!status.includes('Playing') && !status.includes('Paused')) {
			return { playing: false };
		}
		const artist = run('playerctl metadata xesam:artist 2>/dev/null') || 'Unknown artist';
		const title = run('playerctl metadata xesam:title 2>/dev/null') || 'Unknown title';
		const album = run('playerctl metadata xesam:album 2>/dev/null') || '';
		const posStr = run('playerctl position 2>/dev/null') || '0';
		const lenStr = run('playerctl metadata mpris:length 2>/dev/null') || '0';
		return {
			playing: status.includes('Playing'),
			artist,
			title,
			album,
			position: parseFloat(posStr),
			length: parseInt(lenStr, 10) / 1000000 || 0
		};
	} catch (e) {
		return { playing: false };
	}
}

const server = createServer(async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}

	if (req.method === 'POST' && req.url === '/webhook/ha') {
		let body = '';
		req.on('data', chunk => body += chunk);
		req.on('end', () => {
			try {
				const data = JSON.parse(body);
				if (data.event === 'morning') {
					broadcast({ type: 'trigger', event: 'morning', data: data.data || {} });
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: true }));
					return;
				}
			} catch {}
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'invalid payload' }));
		});
		return;
	}

	if (req.method === 'GET' && req.url === '/api/telemetry') {
		const data = await getTelemetry();
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
		return;
	}

	if (req.method === 'GET' && req.url.startsWith('/api/calendar')) {
		const urlObj = new URL(req.url, `http://${req.headers.host}`);
		const days = urlObj.searchParams.get('days') || '3';
		const data = await getCalendar(days);
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
		return;
	}

	if (req.method === 'GET' && req.url === '/api/nowplaying') {
		const data = getNowPlaying();
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
		return;
	}

	handler(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();
let currentView = 'clock';

function broadcast(data) {
	const msg = JSON.stringify(data);
	clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

wss.on('connection', (ws, req) => {
	const isRemote = req.headers['x-remote'] === 'phone' || req.url?.includes('remote');
	ws.isRemote = isRemote;
	clients.add(ws);
	ws.send(JSON.stringify({ type: 'init', view: currentView, ts: Date.now() }));

	ws.on('message', (raw) => {
		try {
			const msg = JSON.parse(raw.toString());
			if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
			if (msg.type === 'navigate') {
				currentView = msg.view;
				broadcast({ type: 'navigate', view: msg.view, from: isRemote ? 'remote' : 'local' });
			}
			if (msg.type === 'swipe') {
				const views = ['clock', 'school', 'dev', 'music'];
				let idx = views.indexOf(currentView);
				if (msg.dir === 'left') idx = (idx + 1) % views.length;
				if (msg.dir === 'right') idx = (idx - 1 + views.length) % views.length;
				currentView = views[idx];
				broadcast({ type: 'navigate', view: currentView, from: 'remote' });
			}
			if (msg.type === 'trigger' && msg.event === 'morning') {
				broadcast({ type: 'trigger', event: 'morning', data: msg.data });
			}
		} catch {}
	});

	ws.on('close', () => clients.delete(ws));
});

server.listen(port, '0.0.0.0', () => console.log(`smart-display running on :${port}`));
