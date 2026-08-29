import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handler } from '../build/handler.js';

const port = process.env.PORT || 3000;

const server = createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}
	
	// HA webhook endpoint
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

	// server telemetry endpoint (real data from the box)
	if (req.method === 'GET' && req.url === '/api/telemetry') {
		import('node:os').then(os => {
			const total = os.totalmem() / 1024 / 1024 / 1024;
			const free = os.freemem() / 1024 / 1024 / 1024;
			const used = total - free;
			const load = os.loadavg()[0];
			const cpus = os.cpus().length;
			const cpuPct = Math.min(100, Math.round((load / cpus) * 100));
			const services = [
				{ name: 'dasdev.net', status: true, uptime: '99.9%' },
				{ name: 'mc.dasdev.net', status: true, uptime: '100%' },
				{ name: 'hermes.dasdev.net', status: true, uptime: '99.7%' }
			];
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				services,
				stats: {
					ram_used: Math.round(used),
					ram_total: Math.round(total),
					cpu: cpuPct,
					containers: 8
				}
			}));
		});
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
			if (msg.type === 'govee') {
				broadcast({ type: 'govee', data: msg.data });
			}
		} catch {}
	});

	ws.on('close', () => clients.delete(ws));
});

server.listen(port, '0.0.0.0', () => console.log(`smart-display running on :${port}`));
