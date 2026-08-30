import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handler } from '../build/handler.js';
import {
	getTelemetry,
	getCalendar,
	getNowPlaying,
	getGitContext,
	getOllamaPs,
	getHAStates,
	triggerHAView
} from './lib/server/hostData.js';

const port = process.env.PORT || 3000;

function json(res, data, status = 200) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

let ollamaPowerState = 'HIGH_PERFORMANCE';
async function pollOllama() {
	try {
		const d = await getOllamaPs();
		const hasModels = d.models && d.models.length > 0;
		const newState = hasModels ? 'LOW_POWER' : 'HIGH_PERFORMANCE';
		if (newState !== ollamaPowerState) {
			ollamaPowerState = newState;
			broadcast({ type: 'power', state: newState });
		}
	} catch {
		if (ollamaPowerState !== 'HIGH_PERFORMANCE') {
			ollamaPowerState = 'HIGH_PERFORMANCE';
			broadcast({ type: 'power', state: 'HIGH_PERFORMANCE' });
		}
	}
}
setInterval(pollOllama, 500);

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
		req.on('data', (chunk) => (body += chunk));
		req.on('end', async () => {
			try {
				const data = JSON.parse(body);
				if (data.event === 'morning' || data.event === 'normal' || data.event === 'sleep') {
					broadcast({ type: 'trigger', event: data.event, view: data.view || currentView, data: data.data || {} });
					json(res, { ok: true, event: data.event });
					return;
				}
				if (data.event === 'navigate' && data.view) {
					currentView = data.view;
					broadcast({ type: 'navigate', view: data.view, from: 'ha' });
					await triggerHAView(data.view);
					json(res, { ok: true });
					return;
				}
				if (data.event === 'hdmi_off') {
					import('node:child_process').then(({ execFile }) => {
						execFile('/home/das/projects/smart-display/scripts/display-off.sh', (e) => {
							if (e) console.error('hdmi_off failed', e.message);
						});
					});
					broadcast({ type: 'trigger', event: 'hdmi_off' });
					json(res, { ok: true });
					return;
				}
				if (data.event === 'hdmi_on') {
					import('node:child_process').then(({ execFile }) => {
						execFile('/home/das/projects/smart-display/scripts/display-on.sh', (e) => {
							if (e) console.error('hdmi_on failed', e.message);
						});
					});
					broadcast({ type: 'trigger', event: 'hdmi_on' });
					json(res, { ok: true });
					return;
				}
			} catch {
				/* fall through */
			}
			json(res, { error: 'invalid payload' }, 400);
		});
		return;
	}

	if (req.method === 'GET' && req.url === '/api/telemetry') {
		json(res, await getTelemetry());
		return;
	}

	if (req.method === 'GET' && req.url?.startsWith('/api/calendar')) {
		const urlObj = new URL(req.url, `http://${req.headers.host}`);
		const days = urlObj.searchParams.get('days') || '3';
		json(res, await getCalendar(days));
		return;
	}

	if (req.method === 'GET' && req.url === '/api/nowplaying') {
		json(res, getNowPlaying());
		return;
	}

	if (req.method === 'GET' && req.url === '/api/git') {
		json(res, getGitContext());
		return;
	}

	if (req.method === 'GET' && req.url === '/api/ha/states') {
		json(res, await getHAStates());
		return;
	}

	if (req.method === 'GET' && req.url === '/api/ollama/ps') {
		json(res, await getOllamaPs());
		return;
	}

	handler(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();
let currentView = 'clock';

function broadcast(data) {
	const msg = JSON.stringify(data);
	clients.forEach((ws) => {
		if (ws.readyState === 1) ws.send(msg);
	});
}

wss.on('connection', (ws, req) => {
	const isRemote = req.headers['x-remote'] === 'phone' || req.url?.includes('remote');
	ws.isRemote = isRemote;
	clients.add(ws);
	ws.send(JSON.stringify({ type: 'init', view: currentView, ts: Date.now(), power: ollamaPowerState }));

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
			if (msg.type === 'trigger') {
				broadcast({ type: 'trigger', event: msg.event, view: msg.view || currentView, data: msg.data || {} });
				if (msg.event === 'hdmi_off') {
					import('node:child_process').then(({ execFile }) => {
						execFile('/home/das/projects/smart-display/scripts/display-off.sh', (e) => { if (e) console.error(e); });
					});
				}
				if (msg.event === 'hdmi_on') {
					import('node:child_process').then(({ execFile }) => {
						execFile('/home/das/projects/smart-display/scripts/display-on.sh', (e) => { if (e) console.error(e); });
					});
				}
			}
		} catch {
			/* ignore */
		}
	});

	ws.on('close', () => clients.delete(ws));
});

server.listen(port, '0.0.0.0', () => console.log(`smart-display running on :${port}`));
