import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';

function run(cmd) {
	try {
		return execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
	} catch {
		return null;
	}
}

let lastNet = { t: 0, rx: 0, tx: 0 };

function readNetThroughput() {
	try {
		const text = readFileSync('/proc/net/dev', 'utf8');
		let rx = 0;
		let tx = 0;
		for (const line of text.split('\n').slice(2)) {
			const parts = line.trim().split(/[:\s]+/);
			const iface = parts[0];
			if (!iface || iface === 'lo') continue;
			rx += parseInt(parts[1], 10) || 0;
			tx += parseInt(parts[9], 10) || 0;
		}
		const now = Date.now();
		let rxMbps = 0;
		let txMbps = 0;
		if (lastNet.t) {
			const dt = (now - lastNet.t) / 1000;
			if (dt > 0) {
				rxMbps = ((rx - lastNet.rx) * 8) / dt / 1e6;
				txMbps = ((tx - lastNet.tx) * 8) / dt / 1e6;
			}
		}
		lastNet = { t: now, rx, tx };
		return {
			rxMbps: Math.max(0, Number(rxMbps.toFixed(2))),
			txMbps: Math.max(0, Number(txMbps.toFixed(2))),
			mbps: Math.max(0, Number((rxMbps + txMbps).toFixed(2)))
		};
	} catch {
		return { rxMbps: 0, txMbps: 0, mbps: 0 };
	}
}

export async function getTelemetry() {
	const total = os.totalmem() / 1024 / 1024 / 1024;
	const free = os.freemem() / 1024 / 1024 / 1024;
	const used = total - free;
	const load = os.loadavg()[0];
	const cpus = os.cpus().length;
	const cpuPct = Math.min(100, Math.round((load / cpus) * 100));
	const net = readNetThroughput();

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
			ram_used: Math.round(used * 10) / 10,
			ram_total: Math.round(total * 10) / 10,
			cpu: cpuPct,
			load,
			cpus,
			containers: parseInt(containers, 10),
			net_rx: net.rxMbps,
			net_tx: net.txMbps,
			net_mbps: net.mbps
		}
	};
}

export async function getCalendar(days = 3) {
	try {
		const tokenPath = process.env.GOOGLE_TOKEN_PATH || '/home/das/.hermes/google_token.json';
		const raw = readFileSync(tokenPath, 'utf8');
		const token = JSON.parse(raw);
		const now = new Date();
		const end = new Date();
		end.setDate(now.getDate() + parseInt(days, 10));
		const timeMin = now.toISOString();
		const timeMax = end.toISOString();
		const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`;
		const r = await fetch(url, {
			headers: { Authorization: `Bearer ${token.access_token || token.token}` }
		});
		if (!r.ok) throw new Error(`calendar ${r.status}`);
		const d = await r.json();
		const events = (d.items || []).map((e) => ({
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

export function getNowPlaying() {
	try {
		const status = run('playerctl status 2>/dev/null') || 'Not available';
		if (!status.includes('Playing') && !status.includes('Paused')) {
			return { playing: false };
		}
		const artist = run('playerctl metadata xesam:artist 2>/dev/null') || 'Unknown artist';
		const title = run('playerctl metadata xesam:title 2>/dev/null') || 'Unknown title';
		const album = run('playerctl metadata xesam:album 2>/dev/null') || '';
		const art = run('playerctl metadata mpris:artUrl 2>/dev/null') || '';
		const posStr = run('playerctl position 2>/dev/null') || '0';
		const lenStr = run('playerctl metadata mpris:length 2>/dev/null') || '0';
		return {
			playing: status.includes('Playing'),
			artist,
			title,
			album,
			art,
			position: parseFloat(posStr),
			length: parseInt(lenStr, 10) / 1_000_000 || 0
		};
	} catch {
		return { playing: false };
	}
}

export function getGitContext() {
	const cwd = process.env.GIT_STATUS_DIR || process.cwd();
	const opts = `git -C ${JSON.stringify(cwd)}`;
	const branch = run(`${opts} rev-parse --abbrev-ref HEAD 2>/dev/null`);
	const message = run(`${opts} log -1 --pretty=%s 2>/dev/null`);
	const shortSha = run(`${opts} rev-parse --short HEAD 2>/dev/null`);
	const dirtyRaw = run(`${opts} status --porcelain 2>/dev/null`);
	const aheadBehind = run(`${opts} status -sb 2>/dev/null`);
	return {
		branch: branch || 'unknown',
		message: message || 'no commits',
		sha: shortSha || '',
		dirty: Boolean(dirtyRaw),
		status: aheadBehind || '',
		changed: dirtyRaw ? dirtyRaw.split('\n').filter(Boolean).length : 0
	};
}

export async function getOllamaPs() {
	try {
		const r = await fetch('http://127.0.0.1:11434/api/ps', {
			signal: AbortSignal.timeout(800)
		});
		if (!r.ok) throw new Error('ollama unreachable');
		return await r.json();
	} catch {
		return { models: [] };
	}
}
