import { createServer } from 'http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { handler } from '../build/handler.js';
import {
	getTelemetry,
	getCalendar,
	getNowPlaying,
	getDemoNowPlaying,
	getGitContext,
	getOllamaPs,
	getHAStates,
	triggerHAView,
	getWeather,
	saveStationData,
	fetchHAStates
} from './lib/server/hostData.js';
import { PROJECT_ROOT, setPanelPower } from './lib/server/displayPower.js';
import { getHostUpdates } from './lib/server/hostUpdates.js';
import { debounceInstalling } from './lib/hostUpdatesModel.js';
import {
	getInstallProgress,
	maybeStartHostUpgrade,
	setInstallProgressListener
} from './lib/server/hostUpgrade.js';
import { getKioskStatus, getBluetoothProximity } from './lib/server/kioskStatus.js';
import { createAudioCapture } from './lib/server/audioCapture.js';
import {
	agentFinishedNotify,
	hostUpdateNotifies,
	parseAirplayConnectedPayload,
	parseBtConnectedPayload,
	parseNotifyPayload,
	scheduleNotify
} from './lib/server/notifyPayload.js';
import { airplayArtPath } from './lib/server/audioNowPlaying.js';
import { applyVolumePayload, getVolume, volumeHttpStatus } from './lib/server/audioVolume.js';
import {
	debounceSignal,
	desiredHdmi,
	isPhoneWakeWindow,
	isQuietHours,
	loadSchedule,
	minutesOfDay,
	normalizeSchedule,
	saveSchedule,
	scheduledAction,
	daysEqual
} from './lib/server/displaySchedule.js';
import { becameOn, describePhoneSensor, pickPhoneWakeSensor } from './lib/server/haPhone.js';
import { probeAlignEngine } from './lib/server/forcedAlign.js';
import { lyricsDbStats } from './lib/server/lyricsStore.js';

const port = process.env.PORT || 3000;
const SCHEDULE_PATH =
	process.env.DISPLAY_SCHEDULE_PATH || path.join(PROJECT_ROOT, 'data/display-schedule.json');
const SCHEDULE_TICK_MS = 15_000;

let schedule = loadSchedule(SCHEDULE_PATH);
let hdmiState = 'on';
let lastTickMinutes = null;
let applyingHdmi = false;
let phoneWatch = { entity: '', label: '', on: false, status: 'idle' };
let lastPhoneSensor = null;
let proximityWatch = { address: '', label: '', distanceMeters: null, near: false };
const proximityDebounce = {};

function json(res, data, status = 200) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

function reqPath(req) {
	try {
		return decodeURIComponent(new URL(req.url, 'http://local').pathname);
	} catch {
		return String(req.url || '').split('?')[0];
	}
}

async function audioSnapshot() {
	const result = await getVolume();
	if (!result.ok) return null;
	return { volume: result.volume, muted: result.muted };
}

function handleAudioConnected(req, res, parse, from) {
	let raw = '';
	req.on('data', (chunk) => (raw += chunk));
	req.on('end', () => {
		const { notify } = parse(raw);
		currentView = 'music';
		broadcast({ type: 'navigate', view: 'music', from });
		broadcast(notify);
		json(res, { ok: true });
	});
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

const HOST_UPDATES_POLL_MS = 15_000;
let lastHostUpdates = null;
const installingDebounce = {};

async function pollHostUpdates() {
	try {
		const raw = await getHostUpdates();
		maybeStartHostUpgrade(raw);
		// The dpkg-lock/pgrep probes behind `installing` can flicker between
		// polls; only feed a confirmed, stable reading to change detection so
		// a flapping false positive doesn't spam install-start/install-end
		// notices (and the big Dynamic Island banner that comes with them).
		const next = { ...raw, installing: debounceInstalling(installingDebounce, raw.installing) };
		if (lastHostUpdates) {
			for (const msg of hostUpdateNotifies(lastHostUpdates, next)) {
				broadcast(msg);
			}
		}
		lastHostUpdates = next;
	} catch {
		/* probe failed; try again next tick */
	}
}
setTimeout(pollHostUpdates, 8_000);
setInterval(pollHostUpdates, HOST_UPDATES_POLL_MS);

// Taps system audio and streams live spectrum/bass frames so the waveform
// and background shader actually track what's playing, instead of a
// synthetic beat clock. Only runs while something is playing so an idle
// kiosk isn't running an audio-capture subprocess for nothing.
const AUDIO_PLAYING_POLL_MS = 3_000;
const audioCapture = createAudioCapture({
	onFrame: (frame) => broadcast({ type: 'audioSpectrum', ...frame })
});
let audioCaptureWanted = false;

async function pollAudioPlaying() {
	try {
		const np = await getNowPlaying({ skipLyrics: true });
		const wantsCapture = Boolean(np?.playing);
		if (wantsCapture !== audioCaptureWanted) {
			audioCaptureWanted = wantsCapture;
			if (wantsCapture) audioCapture.start();
			else audioCapture.stop();
		}
	} catch {
		/* nowPlaying probe failed; try again next tick */
	}
}
setInterval(pollAudioPlaying, AUDIO_PLAYING_POLL_MS);
pollAudioPlaying();

function displaySnapshot() {
	return {
		hdmi: hdmiState,
		schedule,
		quiet: isQuietHours(new Date(), schedule),
		phone: {
			...phoneWatch,
			wakeWindow: isPhoneWakeWindow(new Date(), schedule)
		},
		proximity: proximityWatch
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

async function handlePhoneWake(source = 'ha') {
	if (!schedule.wakeOnPhone) return { ok: false, reason: 'disabled' };
	if (hdmiState === 'on') return { ok: true, reason: 'already-on' };
	if (!isPhoneWakeWindow(new Date(), schedule)) return { ok: false, reason: 'outside-window' };
	await handleTrigger('morning', { view: 'school', data: { from: source } });
	return { ok: true, reason: 'woke' };
}

async function pollPhone() {
	const { states, status, error } = await fetchHAStates();
	if (status !== 'ok') {
		phoneWatch = { ...phoneWatch, status, error: error || status };
		return;
	}
	const sensor = pickPhoneWakeSensor(states);
	const prev = lastPhoneSensor;
	lastPhoneSensor = sensor;
	phoneWatch = sensor
		? { ...describePhoneSensor(sensor), status: 'ok' }
		: { entity: '', label: '', on: false, status: 'missing' };
	if (becameOn(prev, sensor)) await handlePhoneWake('poll');
}

function phoneLoop() {
	pollPhone().finally(() => {
		const wait = phoneWatch.status === 'no-auth' || phoneWatch.status === 'error' ? 60_000 : 8_000;
		setTimeout(phoneLoop, wait);
	});
}

/** Wakes the display when a configured Bluetooth device (calibrated from
 *  /remote/stats, which shows live RSSI-estimated distance for every
 *  connected device) reads inside the configured range. Unlike phone-wake,
 *  this isn't limited to the early-morning window - it's meant to work
 *  anytime the panel is off, like walking into the room. */
async function handleProximityWake(source = 'ble') {
	if (!schedule.wakeOnProximity) return { ok: false, reason: 'disabled' };
	if (hdmiState === 'on') return { ok: true, reason: 'already-on' };
	await handleTrigger('normal', { data: { from: source } });
	return { ok: true, reason: 'woke' };
}

async function pollProximity() {
	if (!schedule.wakeOnProximity || !schedule.proximityDevice) {
		proximityWatch = { address: schedule.proximityDevice || '', label: '', distanceMeters: null, near: false };
		return;
	}
	try {
		const devices = await getBluetoothProximity();
		const match = devices.find((d) => d.address === schedule.proximityDevice);
		const distanceMeters = match?.distanceMeters ?? null;
		const rawNear = distanceMeters != null && distanceMeters <= schedule.proximityMeters;
		// The same flicker-guard used for the update banner: a single noisy
		// RSSI reading shouldn't be enough to wake the panel.
		const near = debounceSignal(proximityDebounce, rawNear);
		proximityWatch = { address: schedule.proximityDevice, label: match?.name || '', distanceMeters, near };
		if (near) await handleProximityWake('poll');
	} catch {
		/* bluetoothctl probe failed; try again next tick */
	}
}

function proximityLoop() {
	pollProximity().finally(() => {
		setTimeout(proximityLoop, 8_000);
	});
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
	const action = scheduledAction(lastTickMinutes, curr, schedule, now);
	lastTickMinutes = curr;
	if (action) await applyHdmi(action, { reason: 'schedule' });
}

function patchSchedule(input) {
	const prev = {
		enabled: schedule.enabled,
		offAt: schedule.offAt,
		onAt: schedule.onAt,
		wakeOnPhone: schedule.wakeOnPhone,
		days: schedule.days
	};
	const wasEnabled = schedule.enabled;
	schedule = saveSchedule(SCHEDULE_PATH, normalizeSchedule(input, schedule));
	lastTickMinutes = null;
	broadcast({ type: 'display', ...displaySnapshot() });
	const changed =
		prev.enabled !== schedule.enabled ||
		prev.offAt !== schedule.offAt ||
		prev.onAt !== schedule.onAt ||
		prev.wakeOnPhone !== schedule.wakeOnPhone ||
		!daysEqual(prev.days, schedule.days);
	if (changed) broadcast(scheduleNotify(schedule));
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
				if (data.event === 'phone_wake') {
					const result = await handlePhoneWake('webhook');
					json(res, { ok: result.ok, event: 'phone_wake', ...result });
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
				if (typeof data.wakeOnPhone === 'boolean') next.wakeOnPhone = data.wakeOnPhone;
				if (data.offAt) next.offAt = data.offAt;
				if (data.onAt) next.onAt = data.onAt;
				if (data.timeZone) next.timeZone = data.timeZone;
				if (data.phoneWakeAfter) next.phoneWakeAfter = data.phoneWakeAfter;
				if (Array.isArray(data.days) || typeof data.days === 'string') next.days = data.days;
				if (typeof data.wakeOnProximity === 'boolean') next.wakeOnProximity = data.wakeOnProximity;
				if (typeof data.proximityDevice === 'string') next.proximityDevice = data.proximityDevice;
				if (data.proximityMeters !== undefined) next.proximityMeters = data.proximityMeters;
				if (data.schedule && typeof data.schedule === 'object') Object.assign(next, data.schedule);
				const changedSchedule =
					data.enabled !== undefined ||
					data.wakeOnPhone !== undefined ||
					data.offAt ||
					data.onAt ||
					data.timeZone ||
					data.phoneWakeAfter ||
					data.days !== undefined ||
					data.wakeOnProximity !== undefined ||
					data.proximityDevice !== undefined ||
					data.proximityMeters !== undefined ||
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

	if (req.method === 'GET' && reqPath(req) === '/api/volume') {
		const result = await getVolume();
		json(res, result, volumeHttpStatus(result));
		return;
	}

	if (req.method === 'POST' && reqPath(req) === '/api/volume') {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', async () => {
			try {
				const data = JSON.parse(body || '{}');
				const result = await applyVolumePayload(data);
				if (result.ok) {
					broadcast({ type: 'volume', volume: result.volume, muted: result.muted });
				}
				json(res, result, volumeHttpStatus(result));
			} catch {
				json(res, { ok: false, error: 'invalid payload' }, 400);
			}
		});
		return;
	}

	if (req.method === 'GET' && req.url === '/api/telemetry') {
		json(res, await getTelemetry());
		return;
	}

	if (req.method === 'GET' && req.url === '/api/kiosk') {
		json(res, await getKioskStatus());
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
		handleAudioConnected(req, res, parseBtConnectedPayload, 'bluetooth');
		return;
	}

	if (req.method === 'POST' && req.url === '/api/airplay/connected') {
		handleAudioConnected(req, res, parseAirplayConnectedPayload, 'airplay');
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

	if (req.method === 'GET' && reqPath(req) === '/api/nowplaying') {
		const demo = new URL(req.url, 'http://local').searchParams.get('demo');
		json(res, demo === 'music' ? getDemoNowPlaying() : await getNowPlaying());
		return;
	}

	if (req.method === 'GET' && req.url?.startsWith('/api/nowplaying/art')) {
		const file = airplayArtPath();
		if (!existsSync(file)) {
			json(res, { error: 'no art' }, 404);
			return;
		}
		res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
		res.end(readFileSync(file));
		return;
	}

	if (req.method === 'GET' && req.url === '/api/git') {
		json(res, await getGitContext());
		return;
	}

	if (req.method === 'GET' && req.url === '/api/updates') {
		const snapshot = await getHostUpdates();
		maybeStartHostUpgrade(snapshot);
		json(res, { ...snapshot, progress: getInstallProgress() });
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

setInstallProgressListener((progress) => {
	broadcast({ ...progress, type: 'installProgress' });
});

wss.on('connection', (ws, req) => {
	const isRemote = req.headers['x-remote'] === 'phone' || req.url?.includes('remote');
	ws.isRemote = isRemote;
	clients.add(ws);

	// Listeners go on before the (now async, since audioSnapshot shells out
	// to wpctl) init send below, so a message the client fires off right
	// after connecting can't arrive before anything's listening for it.
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

	(async () => {
		const audio = await audioSnapshot();
		if (ws.readyState !== 1) return;
		ws.send(
			JSON.stringify({
				type: 'init',
				view: currentView,
				ts: Date.now(),
				power: ollamaPowerState,
				display: displaySnapshot(),
				audio,
				installProgress: getInstallProgress()
			})
		);
	})();
});

server.listen(port, '0.0.0.0', () => {
	console.log(`smart-display running on :${port}`);
	console.log(
		`display schedule ${schedule.enabled ? 'on' : 'off'} ${schedule.offAt}->${schedule.onAt} ${schedule.timeZone}` +
			` days ${schedule.days.join(',')}` +
			` phone-wake ${schedule.wakeOnPhone ? 'on' : 'off'} after ${schedule.phoneWakeAfter}`
	);
	setTimeout(tickSchedule, 2500);
	setInterval(tickSchedule, SCHEDULE_TICK_MS);
	setTimeout(phoneLoop, 4000);
	setTimeout(proximityLoop, 4000);
	const lyricsDb = lyricsDbStats();
	console.log(
		lyricsDb.available
			? `lyrics db ${lyricsDb.path}: ${lyricsDb.lyrics} tracks (${lyricsDb.wordLevel} word-level),` +
					` ${lyricsDb.alignments} alignments (${lyricsDb.precise} precise)`
			: 'lyrics db: unavailable, caching in memory only'
	);
	probeAlignEngine().then((info) => {
		console.log(
			`lyrics aligner: ${info.engine}${info.precise ? ' (frame-accurate)' : ' (energy stand-in)'}` +
				` available ${info.available.join(',')}`
		);
	});
});
