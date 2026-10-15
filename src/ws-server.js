import { createServer } from 'http';
import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { handler } from '../build/handler.js';
import {
	getTelemetry,
	getCalendar,
	getNowPlaying,
	getDemoNowPlaying,
	getVoiceDemoNowPlaying,
	getGitContext,
	getOllamaPs,
	getHAStates,
	triggerHAView,
	getWeather,
	nwsWatch,
	getGoogleTasks,
	saveStationData
} from './lib/server/hostData.js';
import { PROJECT_ROOT, readHdmiStamp, setPanelPower } from './lib/server/displayPower.js';
import { createTaskHub } from './lib/server/taskHub.js';
import { createApprovalHub } from './lib/server/approvalHub.js';
import { createDayLogHub } from './lib/server/dayLogHub.js';
import { createActionHub } from './lib/server/actionHub.js';
import { createVoiceHub } from './lib/server/voiceHub.js';
import { createSoundHub } from './lib/server/soundHub.js';
import { createAttentionHub } from './lib/server/attentionHub.js';
import { ringForWarnings } from './lib/server/nwsWatch.js';
import { createPairing, isLocalAddress } from './lib/server/pairing.js';
import { createSensesHub } from './lib/server/sensesHub.js';
import { createLedgerHub } from './lib/server/ledgerHub.js';
import { createEventLog } from './lib/server/eventLog.js';
import { normalizeSurface } from './lib/surface.js';
import { dayKey } from './lib/dayLog.js';
import { speechForDue } from './lib/wallVoice.js';
import { createCalendarFeed } from './lib/server/calendarFeed.js';
import { listAddresses } from './lib/addresses.js';
import os from 'node:os';
import { runPlayerctl } from './lib/server/playerctlBin.js';
import { getHostUpdates } from './lib/server/hostUpdates.js';
import { debounceInstalling } from './lib/hostUpdatesModel.js';
import {
	getInstallProgress,
	maybeStartHostUpgrade,
	setInstallProgressListener
} from './lib/server/hostUpgrade.js';
import { getKioskStatus } from './lib/server/kioskStatus.js';
import { createAudioCapture } from './lib/server/audioCapture.js';
import {
	agentFinishedNotify,
	hostUpdateNotifies,
	parseAirplayConnectedPayload,
	parseAirplayDisconnectedPayload,
	parseBtConnectedPayload,
	parseBtDisconnectedPayload,
	parseNotifyPayload,
	scheduleNotify
} from './lib/server/notifyPayload.js';
import {
	getAgentRoster,
	ingestAgentNotify,
	ingestOllamaStatus
} from './lib/server/agentRosterState.js';
import { swipeKioskView, canonicalizeKioskView } from './lib/kioskViews.js';
import { airplayArtPath, airplayStatePath } from './lib/server/audioNowPlaying.js';
import { applyVolumePayload, getVolume, setMute, setVolume, volumeHttpStatus } from './lib/server/audioVolume.js';
import {
	isPhoneWakeWindow,
	isQuietHours,
	loadSchedule,
	normalizeSchedule,
	saveSchedule,
	schedulePatchAction,
	scheduleTick,
	applyDisplayPatch,
	describeWeek,
	desiredHdmi,
	nextChange
} from './lib/server/displaySchedule.js';
import { probeAlignEngine } from './lib/server/forcedAlign.js';
import { lyricsDbStats } from './lib/server/lyricsStore.js';
import { getHostLoad } from './lib/server/hostLoad.js';
import { evaluateDisplayLoad } from './lib/displayLoad.js';
import {
	nowPlayingPollMs,
	nowPlayingPushKind,
	nowPlayingPushPayload,
	publishNowPlaying
} from './lib/server/nowPlayingPush.js';
import { setBluetoothConnectionCache } from './lib/server/bluetoothConnection.js';

const port = process.env.PORT || 3000;
const SCHEDULE_PATH =
	process.env.DISPLAY_SCHEDULE_PATH || path.join(PROJECT_ROOT, 'data/display-schedule.json');
const SCHEDULE_TICK_MS = 15_000;

let schedule = loadSchedule(SCHEDULE_PATH);

// the day as a recording (src/lib/eventLog.js): redacted broadcasts, 14 days, replayable
const eventLog = createEventLog({
	dir: path.join(PROJECT_ROOT, 'data/log'),
	isLocal: (req) => isLocalAddress(req.socket?.remoteAddress, ownAddresses())
});

/** The ledger hub (set up once the hubs it reads exist) and the hub messages that can move it. */
let ledgerHub = null;
const LEDGER_INPUTS = new Set(['tasks', 'approvals', 'attention', 'weather-alerts', 'agents']);

// Chores, little jobs and alerts: /api/tasks for other platforms, /ws for the
// kiosk and remote, a scheduler that raises due items on the island.
// the day's tally, printed as a receipt when StandBy comes on at night
const dayLog = createDayLogHub({ dataDir: path.join(PROJECT_ROOT, 'data') });
// the wall's voice (ElevenLabs, cached; captions only without a key)
const voiceHub = createVoiceHub({
	dataDir: path.join(PROJECT_ROOT, 'data'),
	broadcast: (msg) => {
		// the webcam's ears close while the wall talks, so it never answers itself
		if (msg?.type === 'speak' && msg.url) sensesHub.noteSpeaking(msg.text);
		broadcast(msg);
	},
	// louder across the room, softer lying down at night, held for an empty room
	room: () => sensesHub.presence()
});
// sounds made from the phone (ElevenLabs sound effects, kept in data/sounds/)
const soundHub = createSoundHub({
	dataDir: path.join(PROJECT_ROOT, 'data'),
	getKey: () => voiceHub.key(),
	broadcast: (msg) => broadcast(msg)
});
// what must get your attention: timers, reminders, agents asking, severe
// weather, chores due. Wakes the panel and keeps ringing until acknowledged
// (src/lib/attention.js). It listens to what the hubs announce (attentionTap).
const attentionHub = createAttentionHub({
	broadcast: (msg) => broadcast(msg),
	isQuiet: () => Boolean(voiceHub.snapshot().quietNow),
	wake: async () => {
		if (hdmiState === 'on') return false;
		// not a hand-made change: keep whatever hold the schedule had
		const hold = hdmiHold;
		await applyHdmi('on', { reason: 'attention' });
		hdmiHold = hold;
		return true;
	},
	restore: async () => {
		if (hdmiState !== 'on') return;
		const hold = hdmiHold;
		await applyHdmi('off', { reason: 'attention' });
		hdmiHold = hold;
	}
});
// NWS alerts for home, checked every 15 to 30 seconds (src/lib/server/nwsWatch.js).
// Every change goes straight to the wall and the phone; a new act-now warning
// (tornado, severe thunderstorm, flash flood…) rings until someone answers,
// and goes quiet by itself when NWS ends or cancels it.
nwsWatch.subscribe(() => broadcast({ type: 'weather-alerts', ...nwsWatch.status() }));
ringForWarnings(nwsWatch, attentionHub);
nwsWatch.start();

/** Raise and settle attention items from what the hubs broadcast. */
function attentionTap(msg) {
	if (msg?.type === 'notify') attentionHub.fromNotify(msg);
	else if (msg?.type === 'tasks' && Array.isArray(msg.tasks)) attentionHub.syncTasks(msg.tasks);
	else if (msg?.type === 'approvals' && Array.isArray(msg.approvals)) attentionHub.syncApprovals(msg.approvals);
}
const taskHub = createTaskHub({
	dataDir: path.join(PROJECT_ROOT, 'data'),
	broadcast: (msg) => {
		broadcast(msg);
		attentionTap(msg);
	},
	onEvent: (event, task) => {
		if (event === 'task.done' && task.kind === 'chore') dayLog.record('chore', { title: task.title });
		if (event === 'task.due' && task.kind === 'alert') {
			dayLog.record('alert', { title: task.title });
			// timers and reminders are said out loud where you are: at the wall,
			// once the panel is awake (raising the alert may have just turned it on)
			attentionHub
				.awake()
				.then(() => voiceHub.say(speechForDue(task), { source: 'Reminder', caption: false }))
				.catch(() => {});
		}
	},
	// "tell the wall" commands; actionHub is defined below and only called later
	commands: (text) => actionHub.command(text),
	// homework and reminders from Google Calendar / Tasks, read-only
	external: () => calendarFeed.items()
});
const calendarFeed = createCalendarFeed({
	loadEvents: async () => (await getCalendar(7))?.all ?? [],
	loadGoogleTasks: getGoogleTasks,
	onChange: () => taskHub.externalChanged()
});
const approvalHub = createApprovalHub({
	dataDir: path.join(PROJECT_ROOT, 'data'),
	broadcast: (msg) => {
		broadcast(msg);
		attentionTap(msg);
	},
	onDecide: (a) => dayLog.record('approval', { decision: a.status })
});
// the Action button and spoken commands (see src/lib/wallActions.js)
// the camera turned the panel off because the room emptied: coming back turns it on (src/lib/senses.js placeStep)
const CAMERA_OFF_REASONS = new Set(['away', 'left-room']);
let cameraTurnedOff = false;
const PLAYER_ARGS = { pause: ['pause'], play: ['play'], next: ['next'], previous: ['previous'] };
const actionHub = createActionHub({
	dataDir: path.join(PROJECT_ROOT, 'data'),
	taskHub,
	approvalHub,
	broadcast: (msg) => broadcast(msg),
	getState: () => ({ nowPlaying: lastNowPlaying, view: currentView, hdmi: hdmiState }),
	attention: { list: () => attentionHub.snapshot(), ack: (id) => attentionHub.ack(id) },
	navigate: (view) => {
		currentView = canonicalizeKioskView(view);
		broadcast({ type: 'navigate', view: currentView, from: 'siri' });
	},
	player: async (action) => {
		const r = await runPlayerctl(PLAYER_ARGS[action] || [action], { timeout: 2000 });
		kickNowPlaying();
		return r;
	},
	screen: (state) => applyHdmi(state, { reason: 'siri' }),
	volume: {
		get: () => getVolume(),
		apply: (target) => (target.muted !== undefined ? setMute(target.muted) : setVolume(target.volume))
	},
	loadWeather: () => getWeather(24),
	loadEvents: async () => (await getCalendar(1))?.events || [],
	announce: (text) => voiceHub.say(text, { source: 'iPhone' })
});
// the webcam's microphone and camera (senses/, a local Python process): "hey
// wall …" from across the room, notes when asked, and how far away you are.
// Only words and numbers reach here (src/lib/server/sensesHub.js, docs/senses.md).
const sensesHub = createSensesHub({
	dataDir: path.join(PROJECT_ROOT, 'data'),
	broadcast: (msg) => broadcast(msg),
	command: async (text) => (await taskHub.sayAdd({ text, source: 'Wall mic' })).data,
	// the answer to something just said to the wall: never held for "while you were out"
	say: (text) => voiceHub.say(text, { source: 'Wall', reply: true }),
	isLocal: (req) => isLocalAddress(req.socket?.remoteAddress, ownAddresses()),
	timeZone: process.env.TZ || undefined,
	// walking up to the wall turns the panel on, but not at night
	// getting up in the morning (lying down, then upright) is the morning wake
	onPresence: (now, before) => {
		if (before.posture === 'lying' && now.posture === 'upright') handlePhoneWake('camera').catch(() => {});
		// back in the room: what was said while nobody was here
		if (before.camera && now.camera && !before.count && now.count) voiceHub.welcomeBack().catch(() => {});
	},
	// places: settling in a spot shows its page; lying down there at night,
	// or nobody home for a while, turns the panel off (src/lib/senses.js placeStep)
	isQuiet: () => Boolean(voiceHub.snapshot().quietNow),
	onPlace: (action) => {
		if (action.navigate) {
			const view = canonicalizeKioskView(action.navigate);
			if (view === currentView) return;
			currentView = view;
			broadcast({ type: 'navigate', view, from: 'place' });
		} else if (action.panel === 'off' && hdmiState === 'on') {
			applyHdmi('off', { reason: action.reason }).catch(() => {});
			cameraTurnedOff = CAMERA_OFF_REASONS.has(action.reason);
		} else if (action.panel === 'on' && cameraTurnedOff) {
			// back in the room: on again, unless something else has turned it off since, or it's night
			cameraTurnedOff = false;
			if (hdmiState !== 'off' || voiceHub.snapshot().quietNow) return;
			if (isQuietHours(new Date(), schedule) || desiredHdmi(new Date(), schedule) === 'off') return;
			handleTrigger('normal', { data: { from: 'camera' } }).catch(() => {});
		}
	},
	onNear: () => {
		if (!sensesHub.snapshot().settings.wakePanel || hdmiState === 'on' || voiceHub.snapshot().quietNow) return;
		handleTrigger('normal', { data: { from: 'camera' } }).catch(() => {});
	}
});
setInterval(() => sensesHub.tick(), 5000);
// the day as one timeline (src/lib/ledger.js): built from the hubs, never stored
ledgerHub = createLedgerHub({
	sources: () => ({
		tasks: taskHub.snapshot(),
		approvals: approvalHub.snapshot(),
		attention: attentionHub.snapshot(),
		alerts: nwsWatch.alerts(),
		day: dayLog.state().days?.[dayKey(Date.now())] ?? null
	}),
	broadcast: (msg) => broadcast(msg)
});
let hdmiState = readHdmiStamp() === 'off' ? 'off' : 'on';
/** What the schedule wanted at the last check ('on' | 'off'), to notice when it changes its mind. */
let lastDesired = null;
let hdmiHold = null;
let applyingHdmi = false;
let pendingHdmi = null;

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

function broadcastAgents() {
	broadcast({ type: 'agents', agents: getAgentRoster() });
}

function publishNotify(notify) {
	const { roster, openAgents } = ingestAgentNotify(notify);
	if (notify.source && (String(notify.kind).toLowerCase() === 'done' || /\bfinished$/i.test(String(notify.title || '')))) {
		dayLog.record('agent', { source: notify.source });
	}
	if (openAgents) {
		currentView = 'agents';
		broadcast({ type: 'navigate', view: 'agents', from: 'notify' });
	}
	broadcast(notify);
	broadcast({ type: 'agents', agents: roster });
}

function handleAudioConnected(req, res, parse, from) {
	let raw = '';
	req.on('data', (chunk) => (raw += chunk));
	req.on('end', () => {
		const { notify } = parse(raw);
		if (from === 'bluetooth') setBluetoothConnectionCache(true);
		currentView = 'music';
		broadcast({ type: 'navigate', view: 'music', from });
		broadcast(notify);
		json(res, { ok: true });
		kickNowPlaying();
	});
}

function handleAudioDisconnected(req, res, parse, from) {
	let raw = '';
	req.on('data', (chunk) => (raw += chunk));
	req.on('end', () => {
		const { notify } = parse(raw);
		if (from === 'bluetooth') setBluetoothConnectionCache(false);
		broadcast({ type: 'nowPlaying', kind: 'disconnect', playing: false, from });
		broadcast(notify);
		json(res, { ok: true });
		lastNowPlaying = { playing: false };
		kickNowPlaying();
	});
}

let ollamaPowerState = 'HIGH_PERFORMANCE';
let displayQualityState = 'full';
let lastLoadBroadcast = '';
let lastLoadSnap = {
	type: 'load',
	cpu: 0,
	ramPct: 0,
	ram_used: 0,
	ram_total: 0,
	quality: 'full',
	freeze: false,
	inferring: false,
	installing: false,
	reasons: []
};

function loadSnapshot() {
	return lastLoadSnap;
}

function computeLoadSnapshot(load, inferring) {
	const installing = Boolean(getInstallProgress()?.active);
	const next = evaluateDisplayLoad(
		{ cpu: load.cpu, ramPct: load.ramPct, inferring, installing },
		displayQualityState
	);
	displayQualityState = next.quality;
	lastLoadSnap = {
		type: 'load',
		cpu: load.cpu,
		ramPct: Math.round(load.ramPct),
		ram_used: load.ram_used,
		ram_total: load.ram_total,
		quality: next.quality,
		freeze: next.freezeShaders,
		inferring,
		installing,
		reasons: next.reasons
	};
	return lastLoadSnap;
}

async function pollHostLoad() {
	try {
		const d = await getOllamaPs();
		const hasModels = d.models && d.models.length > 0;
		const newState = hasModels ? 'LOW_POWER' : 'HIGH_PERFORMANCE';
		const inferring = hasModels;
		const snap = computeLoadSnapshot(getHostLoad(), inferring);
		if (newState !== ollamaPowerState) {
			const prev = ollamaPowerState;
			ollamaPowerState = newState;
			broadcast({ type: 'power', state: newState, quality: snap.quality });
			broadcast(snap);
			lastLoadBroadcast = `${snap.quality}|${snap.cpu}|${snap.ramPct}|${snap.inferring}`;
			if (prev === 'LOW_POWER' && newState === 'HIGH_PERFORMANCE') {
				publishNotify(agentFinishedNotify());
			} else if (newState === 'LOW_POWER') {
				const { changed } = ingestOllamaStatus('inferring');
				if (changed) broadcastAgents();
			}
			return;
		}
		const sig = `${snap.quality}|${snap.cpu}|${snap.ramPct}|${snap.inferring}`;
		if (sig !== lastLoadBroadcast) {
			lastLoadBroadcast = sig;
			broadcast(snap);
		}
	} catch {
		if (ollamaPowerState !== 'HIGH_PERFORMANCE') {
			ollamaPowerState = 'HIGH_PERFORMANCE';
			broadcast({ type: 'power', state: 'HIGH_PERFORMANCE' });
			publishNotify(agentFinishedNotify());
		}
		broadcast(computeLoadSnapshot(getHostLoad(), false));
	}
}
setInterval(pollHostLoad, 1000);

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

const audioCapture = createAudioCapture({
	onFrame: (frame) => broadcast({ type: 'audioSpectrum', ...frame })
});
let audioCaptureWanted = false;
let lastNowPlaying = null;
let nowPlayingTimer = 0;
let nowPlayingSoon = 0;
let nowPlayingInflight = false;

function syncAudioCapture(np) {
	const wantsCapture = Boolean(np?.playing);
	if (wantsCapture === audioCaptureWanted) return;
	audioCaptureWanted = wantsCapture;
	if (wantsCapture) audioCapture.start();
	else audioCapture.stop();
}

async function tickNowPlaying() {
	if (nowPlayingInflight) return;
	nowPlayingInflight = true;
	try {
		const np = await getNowPlaying();
		const published = publishNowPlaying(lastNowPlaying, np);
		const kind = nowPlayingPushKind(lastNowPlaying, published);
		if (kind) broadcast(nowPlayingPushPayload(published, kind));
		if (published?.playing && published.title) dayLog.record('track', { title: published.title, artist: published.artist });
		lastNowPlaying = published;
		syncAudioCapture(published);
	} catch {
		/* nowPlaying probe failed; try again next tick */
	} finally {
		nowPlayingInflight = false;
		clearTimeout(nowPlayingTimer);
		nowPlayingTimer = setTimeout(tickNowPlaying, nowPlayingPollMs(lastNowPlaying));
	}
}

function kickNowPlaying() {
	if (nowPlayingSoon) return;
	nowPlayingSoon = setTimeout(() => {
		nowPlayingSoon = 0;
		clearTimeout(nowPlayingTimer);
		tickNowPlaying();
	}, 20);
}

function watchAirplayNowPlaying() {
	const file = airplayStatePath();
	const dir = path.dirname(file);
	try {
		watch(dir, (_event, filename) => {
			if (!filename) return;
			if (String(filename).includes('smart-display-airplay.json')) kickNowPlaying();
		});
	} catch {
		/* runtime dir may not exist in tests / CI */
	}
}

function displaySnapshot() {
	return {
		hdmi: hdmiState,
		schedule,
		quiet: isQuietHours(new Date(), schedule),
		next: nextChange(new Date(), schedule),
		hold: hdmiHold,
		// the morning wake: getting up (seen by the webcam) after phoneWakeAfter,
		// or Home Assistant's phone_wake webhook
		phone: {
			source: 'camera',
			after: schedule.phoneWakeAfter,
			wakeWindow: isPhoneWakeWindow(new Date(), schedule)
		}
	};
}

function noteManualHdmi(state) {
	if (state === 'on' || state === 'off') hdmiHold = state;
}

async function commitHdmi(state, reason) {
	hdmiState = state;
	await setPanelPower(state === 'on');
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

async function applyHdmi(state, { reason } = {}) {
	if (state !== 'on' && state !== 'off') return hdmiState;
	// anyone else touching the panel: coming back no longer turns it on
	if (!CAMERA_OFF_REASONS.has(reason)) cameraTurnedOff = false;
	// a change anyone else makes is theirs: attention won't turn it back off
	if (reason !== 'attention') attentionHub.panelChanged();
	if (reason !== 'schedule') {
		noteManualHdmi(state);
		pendingHdmi = { state, reason };
	} else if (!pendingHdmi || pendingHdmi.reason === 'schedule') {
		pendingHdmi = { state, reason };
	} else {
		return hdmiState;
	}
	if (applyingHdmi) {
		hdmiState = state;
		return state;
	}
	applyingHdmi = true;
	try {
		while (pendingHdmi) {
			const next = pendingHdmi;
			pendingHdmi = null;
			await commitHdmi(next.state, next.reason);
		}
	} finally {
		applyingHdmi = false;
	}
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

/** The morning wake (schedule.wakeOnPhone, kept by that name for old files):
 *  in the off time after phoneWakeAfter, getting up wakes the panel with the
 *  morning briefing. The webcam sees it (lying down, then upright: senses), or
 *  Home Assistant sends the phone_wake webhook. */
async function handlePhoneWake(source = 'ha') {
	if (!schedule.wakeOnPhone) return { ok: false, reason: 'disabled' };
	if (hdmiState === 'on') return { ok: true, reason: 'already-on' };
	if (!isPhoneWakeWindow(new Date(), schedule)) return { ok: false, reason: 'outside-window' };
	await handleTrigger('morning', { view: 'calendar', data: { from: source } });
	return { ok: true, reason: 'woke' };
}

async function tickSchedule() {
	const now = new Date();
	const result = scheduleTick({
		lastDesired,
		hold: hdmiHold,
		schedule,
		date: now
	});
	lastDesired = result.lastDesired;
	hdmiHold = result.hold;
	if (result.action) await applyHdmi(result.action, { reason: 'schedule' });
}

async function patchSchedule(input) {
	const prev = { ...schedule };
	schedule = saveSchedule(SCHEDULE_PATH, normalizeSchedule(input, schedule));
	const patched = schedulePatchAction(prev, schedule, { hold: hdmiHold });
	hdmiHold = patched.hold;
	const changed =
		prev.enabled !== schedule.enabled ||
		prev.wakeOnPhone !== schedule.wakeOnPhone ||
		JSON.stringify(prev.week) !== JSON.stringify(schedule.week);
	// the next check compares against what the new schedule wants now
	lastDesired = desiredHdmi(new Date(), schedule);
	if (changed) broadcast(scheduleNotify(schedule));
	if (patched.action) await applyHdmi(patched.action, { reason: 'schedule' });
	else broadcast({ type: 'display', ...displaySnapshot() });
	return displaySnapshot();
}

const server = createServer(async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}

	if (await taskHub.handleHttp(req, res)) return;
	if (await approvalHub.handleHttp(req, res)) return;
	if (await actionHub.handleHttp(req, res)) return;
	if (await dayLog.handleHttp(req, res)) return;
	if (await ledgerHub.handleHttp(req, res)) return;
	if (await eventLog.handleHttp(req, res)) return;
	// who's looking at the wall's state right now (src/lib/surface.js)
	if (req.method === 'GET' && req.url?.split('?')[0] === '/api/surfaces') {
		const list = [...clients].filter((c) => c.surface).map((c) => ({ ...c.surface, since: new Date(c.surfaceSince).toISOString(), device: c.device || null }));
		return json(res, { surfaces: list });
	}
	if (await voiceHub.handleHttp(req, res)) return;
	if (await soundHub.handleHttp(req, res)) return;
	if (await sensesHub.handleHttp(req, res)) return;

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

	if (req.method === 'GET' && reqPath(req) === '/api/display') {
		json(res, displaySnapshot());
		return;
	}

	if (req.method === 'POST' && reqPath(req) === '/api/display') {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', async () => {
			try {
				const data = JSON.parse(body || '{}');
				if (data.hdmi === 'on' || data.hdmi === 'off') {
					await applyHdmi(data.hdmi);
				}
				// the week, one day, a copy, or the old single window (displaySchedule.js)
				const { next, changed: changedSchedule } = applyDisplayPatch(schedule, data);
				if (changedSchedule) {
					json(res, { ok: true, ...await patchSchedule(next) });
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

	if (req.method === 'GET' && reqPath(req) === '/api/load') {
		json(res, { ...getHostLoad(), ...loadSnapshot() });
		return;
	}

	if (req.method === 'GET' && reqPath(req) === '/api/kiosk') {
		try {
			json(res, await getKioskStatus());
		} catch (error) {
			console.error('kiosk status failed', error?.message || error);
			json(res, { ok: false, error: 'The display could not read its own status' }, 500);
		}
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

	if (req.method === 'POST' && req.url === '/api/bt/disconnected') {
		handleAudioDisconnected(req, res, parseBtDisconnectedPayload, 'bluetooth');
		return;
	}

	if (req.method === 'POST' && req.url === '/api/airplay/connected') {
		handleAudioConnected(req, res, parseAirplayConnectedPayload, 'airplay');
		return;
	}

	if (req.method === 'POST' && req.url === '/api/airplay/disconnected') {
		handleAudioDisconnected(req, res, parseAirplayDisconnectedPayload, 'airplay');
		return;
	}

	if (req.method === 'GET' && reqPath(req) === '/api/agents') {
		json(res, { agents: getAgentRoster() });
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
				publishNotify(parsed.notify);
				json(res, { ok: true, agents: getAgentRoster() });
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
		json(res, demo === 'music' ? getDemoNowPlaying() : demo === 'voices' ? getVoiceDemoNowPlaying() : await getNowPlaying());
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

// Pairing phones (src/lib/server/pairing.js). Off until turned on from a
// paired phone; the kiosk's own browser is always trusted.
const pairing = createPairing({ dataDir: path.join(PROJECT_ROOT, 'data') });
function ownAddresses() {
	return Object.values(os.networkInterfaces())
		.flat()
		.map((i) => i?.address)
		.filter(Boolean);
}
const trusted = (ws) => ws.local || Boolean(ws.device) || !pairing.required();
function toKiosk(data) {
	const msg = JSON.stringify(data);
	clients.forEach((ws) => ws.local && ws.readyState === 1 && ws.send(msg));
}
let pairCodeTimer = null;
let pairCodeAskedBy = null;
function handlePair(ws, msg) {
	const reply = (data) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'pair', ...data }));
	const canManage = ws.local || Boolean(ws.device);
	if (msg.op === 'start') {
		// anyone may ask: the code only ever shows on the wall itself
		const { code, expiresAt } = pairing.startCode();
		pairCodeAskedBy = ws;
		toKiosk({ type: 'pair-code', code, expiresAt });
		clearTimeout(pairCodeTimer);
		pairCodeTimer = setTimeout(() => toKiosk({ type: 'pair-code-clear' }), Math.max(0, expiresAt - Date.now()));
		return reply({ started: true, expiresAt });
	}
	if (msg.op === 'cancel') {
		// only whoever asked for the code (or a paired phone, or the wall) can take it down
		if (!canManage && ws !== pairCodeAskedBy) return reply({ error: 'not-paired' });
		pairing.cancelCode();
		clearTimeout(pairCodeTimer);
		toKiosk({ type: 'pair-code-clear' });
		return reply({ cancelled: true });
	}
	if (msg.op === 'redeem') {
		const out = pairing.redeem(msg.code, msg.name);
		if (out.error) return reply({ error: out.error });
		clearTimeout(pairCodeTimer);
		toKiosk({ type: 'pair-code-clear', paired: out.device.name });
		ws.device = out.device;
		return reply({ token: out.token, device: out.device });
	}
	if (!canManage) return reply({ error: 'not-paired', status: { required: pairing.required() } });
	if (msg.op === 'require') {
		const status = pairing.setRequired(Boolean(msg.on));
		// sockets that are no longer allowed in are let go
		if (pairing.required()) {
			for (const c of clients) {
				if (trusted(c)) continue;
				c.send(JSON.stringify({ type: 'pair-required' }));
				clients.delete(c);
				c.close(4401, 'pairing required');
			}
		}
		return reply({ status, you: ws.device, local: ws.local });
	}
	if (msg.op === 'rename' && msg.id) {
		const d = pairing.rename(String(msg.id), msg.name);
		if (ws.device?.id === d?.id) ws.device = d;
	}
	if (msg.op === 'revoke' && msg.id) {
		const id = String(msg.id);
		pairing.revoke(id);
		for (const c of clients) {
			if (c.device?.id !== id) continue;
			c.device = null;
			if (!trusted(c)) {
				c.send(JSON.stringify({ type: 'pair-required' }));
				clients.delete(c);
				c.close(4401, 'unpaired');
			}
		}
	}
	return reply({ status: pairing.status(), you: ws.device, local: ws.local });
}
let currentView = 'clock';

function broadcast(data) {
	if (LEDGER_INPUTS.has(data?.type)) ledgerHub?.changed();
	eventLog.record(data);
	const msg = JSON.stringify(data);
	clients.forEach((ws) => {
		if (ws.readyState === 1) ws.send(msg);
	});
}

pollHostLoad();
watchAirplayNowPlaying();
tickNowPlaying();

setInstallProgressListener((progress) => {
	broadcast({ ...progress, type: 'installProgress' });
});

wss.on('connection', (ws, req) => {
	const isRemote = req.headers['x-remote'] === 'phone' || req.url?.includes('remote');
	ws.isRemote = isRemote;
	ws.local = isLocalAddress(req.socket?.remoteAddress, ownAddresses());
	let token = '';
	try {
		token = new URL(req.url || '/', 'http://local').searchParams.get('token') || '';
	} catch {
		/* no token */
	}
	ws.device = pairing.verify(token);
	const admitted = trusted(ws);
	if (admitted) clients.add(ws);
	else ws.send(JSON.stringify({ type: 'pair-required' }));

	// Listeners go on before the (now async, since audioSnapshot shells out
	// to wpctl) init send below, so a message the client fires off right
	// after connecting can't arrive before anything's listening for it.
	ws.on('message', (raw) => {
		try {
			const msg = JSON.parse(raw.toString());
			if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
			if (msg.type === 'pair') return handlePair(ws, msg);
			// not paired while pairing is required: nothing but pairing
			if (!trusted(ws) || !clients.has(ws)) return ws.send(JSON.stringify({ type: 'pair-required' }));
			if (msg.type === 'hello' && msg.role === 'remote') ws.isRemote = true;
			if (msg.type === 'hello' && msg.surface) {
				const surface = normalizeSurface(msg.surface);
				if (surface) {
					if (!ws.surface) ws.surfaceSince = Date.now();
					ws.surface = surface;
				}
			}
			if (msg.type === 'navigate') {
				currentView = canonicalizeKioskView(msg.view);
				// a hand-picked page: the spots leave it alone for a while (Smart Stack's own turns don't count)
				if (!msg.auto) sensesHub.noteManual();
				broadcast({ type: 'navigate', view: currentView, from: ws.isRemote ? 'remote' : 'local' });
			}
			if (msg.type === 'swipe') {
				currentView = swipeKioskView(currentView, msg.dir);
				sensesHub.noteManual();
				broadcast({ type: 'navigate', view: currentView, from: 'remote' });
			}
			if (msg.type === 'trigger') {
				handleTrigger(msg.event, { view: msg.view || currentView, data: msg.data || {} });
			}
			if (msg.type === 'display' && msg.schedule) {
				patchSchedule({ ...schedule, ...msg.schedule });
			}
			if (msg.type === 'tasks') {
				Promise.resolve(taskHub.handleWs(msg))
					.then((result) => {
						if (ws.readyState !== 1) return;
						if (result?.said) ws.send(JSON.stringify({ type: 'tasks-said', ok: result.ok, say: result.say }));
						else if (result?.error) ws.send(JSON.stringify({ type: 'tasks-error', error: result.error, op: msg.op }));
					})
					.catch(() => {});
			}
			if (msg.type === 'addresses') {
				ws.send(JSON.stringify({ type: 'addresses', list: listAddresses(os.networkInterfaces(), port, os.hostname()) }));
			}
			if (msg.type === 'voice') {
				// the phone's Sounds & voice page: { op: 'get' | 'set' | 'say' | 'key' | 'forget-key' }
				const reply = (data) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'voice', ...data }));
				// the ElevenLabs key: the wall, a paired phone, or anyone before the
				// first phone is paired may set it; nobody can read it back
				const mayKey = ws.local || Boolean(ws.device) || pairing.status().devices.length === 0;
				if (msg.op === 'key' || msg.op === 'forget-key') {
					if (!mayKey) reply({ keyResult: { ok: false, error: 'not-paired' }, settings: voiceHub.snapshot() });
					else if (msg.op === 'forget-key') reply({ keyResult: voiceHub.forgetKey(), settings: voiceHub.snapshot() });
					else {
						voiceHub
							.setKey(msg.key)
							.then((keyResult) => reply({ keyResult, settings: voiceHub.snapshot() }))
							.catch(() => reply({ keyResult: { ok: false, error: 'unwritable' } }));
					}
				} else if (msg.op === 'set' && msg.patch && typeof msg.patch === 'object') reply({ settings: voiceHub.setSettings(msg.patch) });
				else if (msg.op === 'say') {
					voiceHub
						.say(String(msg.text || ''), { source: 'iPhone' })
						.then((said) => reply({ said, settings: voiceHub.snapshot() }))
						.catch(() => reply({ said: { ok: false } }));
				} else reply({ settings: voiceHub.snapshot() });
			}
			if (msg.type === 'senses') {
				// the phone's Senses page: { op: 'get' | 'set' | 'calibrate' | 'notes-start' | 'notes-stop' | 'transcripts' | 'transcript' }
				// turning a microphone or camera on is for the wall, a paired phone, or anyone before the first is paired
				const mayChange = ws.local || Boolean(ws.device) || pairing.status().devices.length === 0;
				const out = sensesHub.handleWs(msg, { mayChange });
				if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'senses-reply', ...out }));
			}
			if (msg.type === 'attention') {
				// { op: 'ack', id? } from the wall or the phone (severe weather is raised
				// here on the server, from nwsWatch)
				if (msg.op === 'ack') attentionHub.ack(typeof msg.id === 'string' ? msg.id : undefined);
				else ws.send(JSON.stringify({ type: 'attention', items: attentionHub.snapshot() }));
			}
			if (msg.type === 'sounds') {
				// the phone's sound maker: { op: 'get' | 'generate' | 'assign' | 'delete', ... }
				const reply = (data) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'sounds', ...data }));
				// making a sound spends ElevenLabs credits: the wall, a paired phone, or
				// anyone before the first phone is paired (same rule as the key)
				const maySpend = ws.local || Boolean(ws.device) || pairing.status().devices.length === 0;
				if (msg.op === 'get' || !msg.op) reply({ library: soundHub.snapshot() });
				else if (!maySpend) reply({ result: { ok: false, error: 'not-paired', op: msg.op }, library: soundHub.snapshot() });
				else if (msg.op === 'generate') {
					const input = msg.kind ? { kind: String(msg.kind) } : { idea: String(msg.idea || ''), seconds: msg.seconds };
					soundHub
						.generate(input)
						.then((result) => reply({ result: { ...result, op: 'generate', for: input.kind || input.idea }, library: soundHub.snapshot() }))
						.catch(() => reply({ result: { ok: false, error: 'failed', op: 'generate' } }));
				} else if (msg.op === 'assign') reply({ result: { ...soundHub.assign(String(msg.kind || ''), msg.name ?? null), op: 'assign' }, library: soundHub.snapshot() });
				else if (msg.op === 'delete') reply({ result: { ...soundHub.remove(String(msg.name || '')), op: 'delete' }, library: soundHub.snapshot() });
				else reply({ library: soundHub.snapshot() });
			}
			if (msg.type === 'approvals') {
				const result = approvalHub.handleWs(msg);
				if (result?.error) ws.send(JSON.stringify({ type: 'approvals-error', error: result.error, id: msg.id }));
			}
		} catch {
			/* ignore */
		}
	});

	ws.on('close', () => clients.delete(ws));

	(async () => {
		if (!admitted) return;
		const audio = await audioSnapshot();
		if (ws.readyState !== 1) return;
		ws.send(
			JSON.stringify({
				type: 'init',
				view: currentView,
				ts: Date.now(),
				power: ollamaPowerState,
				load: loadSnapshot(),
				nowPlaying: lastNowPlaying,
				display: displaySnapshot(),
				audio,
				installProgress: getInstallProgress(),
				agents: getAgentRoster(),
				tasks: taskHub.snapshot(),
				approvals: approvalHub.snapshot(),
				attention: attentionHub.snapshot(),
				ledger: ledgerHub.snapshot(),
				weatherAlerts: nwsWatch.status(),
				senses: sensesHub.snapshot(),
				pairing: { required: pairing.required(), device: ws.device, local: ws.local }
			})
		);
	})();
});

// a deploy restarts the service: keep the last few seconds of the day's tally
process.once('SIGTERM', () => {
	dayLog.flush();
	eventLog.flush().finally(() => process.exit(0));
});

/** A full picture for the event log, so a replay can start from any hour. */
function logKeyframe() {
	eventLog.keyframe({
		view: currentView,
		display: displaySnapshot(),
		nowPlaying: lastNowPlaying,
		agents: getAgentRoster(),
		tasks: taskHub.snapshot(),
		approvals: approvalHub.snapshot(),
		attention: attentionHub.snapshot(),
		ledger: ledgerHub.snapshot(),
		weatherAlerts: nwsWatch.status(),
		senses: sensesHub.snapshot()
	});
}

server.listen(port, '0.0.0.0', () => {
	console.log(`smart-display running on :${port}`);
	console.log(
		`display schedule ${schedule.enabled ? 'on' : 'off'} ${describeWeek(schedule.week)} ${schedule.timeZone}` +
			` phone-wake ${schedule.wakeOnPhone ? 'on' : 'off'} after ${schedule.phoneWakeAfter}`
	);
	setTimeout(tickSchedule, 2500);
	setInterval(tickSchedule, SCHEDULE_TICK_MS);
	taskHub.start();
	calendarFeed.start();
	ledgerHub.start();
	setTimeout(logKeyframe, 5000);
	setInterval(logKeyframe, 60 * 60 * 1000);
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
