import { createServer } from 'http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { handler } from '../build/handler.js';
import {
	getTelemetry,
	getCalendar,
	getNowPlaying,
	getGitContext,
	getOllamaPs,
	getHAStates,
	triggerHAView,
	getWeather,
	saveStationData
} from './lib/server/hostData.js';
import { PROJECT_ROOT, setPanelPower } from './lib/server/displayPower.js';
import {
	agentFinishedNotify,
	parseBtConnectedPayload,
	parseNotifyPayload
} from './lib/server/notifyPayload.js';
import {
	desiredHdmi,
	isQuietHours,
	loadSchedule,
	minutesOfDay,
	normalizeSchedule,
	saveSchedule,
	scheduledAction
} from './lib/server/displaySchedule.js';

const port = process.env.PORT || 3000;
const SCHEDULE_PATH =
	process.env.DISPLAY_SCHEDULE_PATH || path.join(PROJECT_ROOT, 'data/display-schedule.json');
const SCHEDULE_TICK_MS = 15_000;

let schedule = loadSchedule(SCHEDULE_PATH);
let hdmiState = 'on';
let lastTickMinutes = null;
let applyingHdmi = false;

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
			const prev = ollamaPowerState;
			ollamaPowerState = newState;
			broadcast({ type: 'power', state: newState });
			if (prev === 'LOW_POWER' && newState === 'HIGH_PERFORMANCE') {
				broadcast(agentFinishedNotify());
			}
		}
	} catch {
		if (ollamaPowerState !== 'HIGH_PERFORMANCE') {
			ollamaPowerState = 'HIGH_PERFORMANCE';
			broadcast({ type: 'power', state: 'HIGH_PERFORMANCE' });
			broadcast(agentFinishedNotify());
		}
	}
}
setInterval(pollOllama, 500);

function displaySnapshot() {
	return {
		hdmi: hdmiState,
		schedule,
		quiet: isQuietHours(new Date(), schedule)
	};
}

async function applyHdmi(state, { reason } = {}) {
	if (state !== 'on' && state !== 'off') return hdmiState;
	if (applyingHdmi) {
		hdmiState = state;
		return state;
	}
	applyingHdmi = true;
	hdmiState = state;
	try {
		await setPanelPower(state === 'on');
	} finally {
		applyingHdmi = false;
	}
	broadcast({ type: 'trigger', event: state === 'off' ? 'hdmi_off' : 'hdmi_on' });
	if (reason === 'schedule' && state === 'off') {
		broadcast({ type: 'trigger', event: 'sleep' });
	}
	if (reason === 'schedule' && state === 'on') {
		broadcast({ type: 'trigger', event: 'normal' });
	}
	broadcast({ type: 'display', ...displaySnapshot() });
	return hdmiState;
}

async function handleTrigger(event, extra = {}) {
	if (event === 'sleep') {
		broadcast({ type: 'trigger', event: 'sleep', view: extra.view, data: extra.data || {} });
		await applyHdmi('off');
		return;
	}
	if (event === 'morning' || event === 'normal') {
		await applyHdmi('on');
		broadcast({
			type: 'trigger',
			event,
			view: extra.view,
			data: extra.data || {}
		});
		return;
	}
	if (event === 'hdmi_off') {
		await applyHdmi('off');
		return;
	}
	if (event === 'hdmi_on') {
		await applyHdmi('on');
		return;
	}
	broadcast({ type: 'trigger', event, view: extra.view, data: extra.data || {} });
}

async function tickSchedule() {
	const now = new Date();
	const curr = minutesOfDay(now, schedule.timeZone);
	if (lastTickMinutes == null) {
		lastTickMinutes = curr;
		const desired = desiredHdmi(now, schedule);
		if (desired) await applyHdmi(desired, { reason: 'schedule' });
		return;
	}
	const action = scheduledAction(lastTickMinutes, curr, schedule);
	lastTickMinutes = curr;
	if (action) await applyHdmi(action, { reason: 'schedule' });
}

function patchSchedule(input) {
	const wasEnabled = schedule.enabled;
	schedule = saveSchedule(SCHEDULE_PATH, normalizeSchedule(input, schedule));
	lastTickMinutes = null;
	broadcast({ type: 'display', ...displaySnapshot() });
	if (wasEnabled && !schedule.enabled && hdmiState === 'off') {
		applyHdmi('on');
		return displaySnapshot();
	}
	tickSchedule();
	return displaySnapshot();
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
		req.on('data', (chunk) => (body += chunk));
		req.on('end', async () => {
			try {
				const data = JSON.parse(body);
				if (data.event === 'morning' || data.event === 'normal' || data.event === 'sleep') {
					await handleTrigger(data.event, { view: data.view || currentView, data: data.data || {} });
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
				if (data.event === 'hdmi_off' || data.event === 'hdmi_on') {
					await handleTrigger(data.event);
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

	if (req.method === 'GET' && req.url === '/api/display') {
		json(res, displaySnapshot());
		return;
	}

	if (req.method === 'POST' && req.url === '/api/display') {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', async () => {
			try {
				const data = JSON.parse(body || '{}');
				if (data.hdmi === 'on' || data.hdmi === 'off') {
					await applyHdmi(data.hdmi);
				}
				const next = { ...schedule };
				if (typeof data.enabled === 'boolean') next.enabled = data.enabled;
				if (data.offAt) next.offAt = data.offAt;
				if (data.onAt) next.onAt = data.onAt;
				if (data.timeZone) next.timeZone = data.timeZone;
				if (data.schedule && typeof data.schedule === 'object') Object.assign(next, data.schedule);
				const changedSchedule =
					data.enabled !== undefined ||
					data.offAt ||
					data.onAt ||
					data.timeZone ||
					data.schedule;
				if (changedSchedule) {
					json(res, { ok: true, ...patchSchedule(next) });
					return;
				}
				json(res, { ok: true, ...displaySnapshot() });
			} catch {
				json(res, { error: 'invalid payload' }, 400);
			}
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

	if (req.method === 'GET' && req.url?.startsWith('/api/weather/station')) {
		const urlObj = new URL(req.url, `http://${req.headers.host}`);
		saveStationData(Object.fromEntries(urlObj.searchParams.entries()));
		json(res, { ok: true, ts: Date.now() });
		return;
	}

	if (req.method === 'POST' && req.url === '/api/weather/station') {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => {
			try {
				const data = JSON.parse(body);
				saveStationData(data);
				json(res, { ok: true, ts: Date.now() });
			} catch (e) {
				json(res, { ok: false, error: e.message }, 400);
			}
		});
		return;
	}

	if (req.method === 'POST' && req.url === '/api/bt/connected') {
		let raw = '';
		req.on('data', (chunk) => (raw += chunk));
		req.on('end', () => {
			const { notify } = parseBtConnectedPayload(raw);
			currentView = 'music';
			broadcast({ type: 'navigate', view: 'music', from: 'bluetooth' });
			broadcast(notify);
			json(res, { ok: true });
		});
		return;
	}

	if (req.method === 'POST' && req.url === '/api/notify') {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => {
			try {
				const parsed = parseNotifyPayload(JSON.parse(body));
				if (parsed.error) {
					json(res, { error: parsed.error }, parsed.status || 400);
					return;
				}
				broadcast(parsed.notify);
				json(res, { ok: true });
			} catch {
				json(res, { error: 'invalid payload' }, 400);
			}
		});
		return;
	}

	if (req.method === 'GET' && req.url === '/api/weather') {
		const urlObj = new URL(req.url, `http://${req.headers.host}`);
		const hours = urlObj.searchParams.get('hours') || '48';
		json(res, await getWeather(parseInt(hours, 10)));
		return;
	}

	if (req.method === 'GET' && req.url === '/api/nowplaying') {
		json(res, await getNowPlaying());
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
	ws.send(
		JSON.stringify({
			type: 'init',
			view: currentView,
			ts: Date.now(),
			power: ollamaPowerState,
			display: displaySnapshot()
		})
	);

	ws.on('message', (raw) => {
		try {
			const msg = JSON.parse(raw.toString());
			if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
			if (msg.type === 'navigate') {
				currentView = msg.view;
				broadcast({ type: 'navigate', view: msg.view, from: isRemote ? 'remote' : 'local' });
			}
			if (msg.type === 'swipe') {
			const views = ['clock', 'school', 'dev', 'music', 'weather'];
				let idx = views.indexOf(currentView);
				if (msg.dir === 'left') idx = (idx + 1) % views.length;
				if (msg.dir === 'right') idx = (idx - 1 + views.length) % views.length;
				currentView = views[idx];
				broadcast({ type: 'navigate', view: currentView, from: 'remote' });
			}
			if (msg.type === 'trigger') {
				handleTrigger(msg.event, { view: msg.view || currentView, data: msg.data || {} });
			}
			if (msg.type === 'display' && msg.schedule) {
				patchSchedule({ ...schedule, ...msg.schedule });
			}
		} catch {
			/* ignore */
		}
	});

	ws.on('close', () => clients.delete(ws));
});

server.listen(port, '0.0.0.0', () => {
	console.log(`smart-display running on :${port}`);
	console.log(
		`display schedule ${schedule.enabled ? 'on' : 'off'} ${schedule.offAt}->${schedule.onAt} ${schedule.timeZone}`
	);
	setTimeout(tickSchedule, 2500);
	setInterval(tickSchedule, SCHEDULE_TICK_MS);
});
