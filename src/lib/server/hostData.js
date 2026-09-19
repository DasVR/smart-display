import { readFileSync } from 'node:fs';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fuseRainPrediction } from '../rainModel.js';
import { LARGO_LAT, LARGO_LON } from '../radarMap.js';
import { applyMeshToCurrent, backyardToSample, estimateAt } from '../ambientMesh.js';
import { fetchAmbientStations } from './ambientStations.js';
import { mergeNowPlaying, readAirplayNowPlaying } from './audioNowPlaying.js';
import { isBluetoothDeviceConnected } from './bluetoothConnection.js';
import { classifySink, parseWpctlStatus, pickSpeakerSink } from './audioSinks.js';
import {
	cancelOtherAlignments,
	ensureAlignedLyrics,
	readCachedAlignmentInfo,
	trackFingerprint
} from './forcedAlign.js';
import { DEMO_TRACK, demoNowPlaying } from '../musicDemo.js';
import { voiceDemoNowPlaying } from '../lyricVoicesDemo.js';
import {
	ensureLyricsCached,
	ensureTrackDurationCached,
	hasRealWordTiming,
	isCollapsedAlignment,
	lyricsCacheKey,
	peekLyricsInfo,
	peekTrackDuration
} from './lyrics.js';
import { overlayCommunityText } from '../lyricWords.js';
import { getLyricPick } from './lyricsStore.js';
import { getHostLoad } from './hostLoad.js';

const execFileAsync = promisify(execFile);

// Async (not execSync) so a slow shell-out here doesn't freeze the whole
// server's event loop - every other request (including the phone remote's)
// would otherwise queue behind it. See kioskStatus.js for the fuller note.
async function run(cmd) {
	try {
		const { stdout } = await execFileAsync('/bin/sh', ['-c', cmd], { encoding: 'utf8', timeout: 3000 });
		return stdout.trim();
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

const HA_TOKEN_PATH = process.env.HA_TOKEN_PATH || '/home/das/projects/smart-display/.ha_token.json';
let haAccessToken = null;
let haTokenExpiry = 0;

async function getHAToken() {
	if (haAccessToken && Date.now() < haTokenExpiry - 60_000) return haAccessToken;
	try {
		const raw = readFileSync(HA_TOKEN_PATH, 'utf8');
		const cfg = JSON.parse(raw);
		const r = await fetch(`${cfg.base_url}/auth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				client_id: cfg.client_id,
				refresh_token: cfg.refresh_token
			})
		});
		if (!r.ok) throw new Error(`ha token ${r.status}`);
		const d = await r.json();
		haAccessToken = d.access_token;
		haTokenExpiry = Date.now() + (d.expires_in * 1000);
		return haAccessToken;
	} catch (e) {
		console.error('ha token error:', e.message);
		return null;
	}
}

export async function fetchHAStates() {
	const token = await getHAToken();
	if (!token) return { states: [], status: 'no-auth' };
	try {
		const raw = readFileSync(HA_TOKEN_PATH, 'utf8');
		const cfg = JSON.parse(raw);
		const r = await fetch(`${cfg.base_url}/api/states`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(3000)
		});
		if (!r.ok) throw new Error(`ha states ${r.status}`);
		const states = await r.json();
		return { states: Array.isArray(states) ? states : [], status: 'ok' };
	} catch (e) {
		console.error('ha states error:', e.message);
		return { states: [], status: 'error', error: e.message };
	}
}

export async function getHAStates() {
	const { states, status, error } = await fetchHAStates();
	if (status !== 'ok') return { entities: [], summary: {}, status, error };
	const summary = {
		temperature: states.find((s) => s.entity_id.startsWith('sensor.') && s.entity_id.includes('temperature'))?.state,
		humidity: states.find((s) => s.entity_id.startsWith('sensor.') && s.entity_id.includes('humidity'))?.state,
		online: states.length,
		lightsOn: states.filter((s) => s.entity_id.startsWith('light.') && s.state === 'on').length,
		doorsOpen: states.filter((s) => s.entity_id.startsWith('binary_sensor.') && s.attributes?.device_class === 'door' && s.state === 'on').length
	};
	return { entities: states.slice(0, 40), summary, status: 'ok' };
}

export async function triggerHAView(view) {
	try {
		const token = await getHAToken();
		if (!token) return { ok: false, error: 'no-auth' };
		const raw = readFileSync(HA_TOKEN_PATH, 'utf8');
		const cfg = JSON.parse(raw);
		const r = await fetch(`${cfg.base_url}/api/events/smart_display_navigate`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ view }),
			signal: AbortSignal.timeout(3000)
		});
		if (!r.ok) throw new Error(`ha event ${r.status}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

/** Reports which PipeWire sink is actually live, so the dashboard can
 *  confirm the speakers wired into the headphone jack (or USB/HDMI) are
 *  recognized and selected, not silently falling back to Dummy Output. */
async function getSpeakerService() {
	const statusText = await run('wpctl status 2>/dev/null');
	if (statusText === null) return { name: 'Speakers', status: false, uptime: 'n/a' };
	const pick = pickSpeakerSink(parseWpctlStatus(statusText));
	if (!pick) return { name: 'Speakers', status: false, uptime: 'none found' };
	const kind = classifySink(pick.name);
	return { name: `Speakers (${kind})`, status: kind !== 'dummy', uptime: pick.name };
}

const SERVICE_TTL_MS = 30_000;
const CONTAINER_TTL_MS = 15_000;
const serviceCache = { at: 0, services: null, inflight: null };
const containerCache = { at: 0, count: 0, inflight: null };

async function checkService(url, name, uptime = '99.9%') {
	try {
		const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
		return { name, status: r.ok, uptime };
	} catch {
		return { name, status: false, uptime: 'down' };
	}
}

async function probeServices() {
	return Promise.all([
		checkService('https://dasdev.net', 'dasdev.net', '99.9%'),
		checkService('https://godmode.dasdev.net', 'godmode', '100%'),
		checkService('https://leadvine.dasdev.net', 'leadvine', '100%'),
		checkService('https://hermes.dasdev.net', 'hermes', '100%'),
		checkService('http://127.0.0.1:8123/api/', 'home assistant', '100%'),
		checkService('http://localhost:3000', 'display', '100%'),
		getSpeakerService()
	]);
}

async function cachedServices() {
	const now = Date.now();
	if (serviceCache.services && now - serviceCache.at < SERVICE_TTL_MS) return serviceCache.services;
	if (serviceCache.inflight) return serviceCache.inflight;
	serviceCache.inflight = probeServices()
		.then((services) => {
			serviceCache.services = services;
			serviceCache.at = Date.now();
			return services;
		})
		.finally(() => {
			serviceCache.inflight = null;
		});
	if (serviceCache.services) return serviceCache.services;
	return serviceCache.inflight;
}

async function cachedContainers() {
	const now = Date.now();
	if (now - containerCache.at < CONTAINER_TTL_MS) return containerCache.count;
	if (containerCache.inflight) return containerCache.inflight;
	containerCache.inflight = run('docker ps -q 2>/dev/null | wc -l')
		.then((text) => {
			containerCache.count = parseInt(text || '0', 10) || 0;
			containerCache.at = Date.now();
			return containerCache.count;
		})
		.finally(() => {
			containerCache.inflight = null;
		});
	if (containerCache.at) return containerCache.count;
	return containerCache.inflight;
}

export async function getTelemetry() {
	const load = getHostLoad();
	const net = readNetThroughput();
	const [services, containers] = await Promise.all([cachedServices(), cachedContainers()]);

	return {
		services,
		stats: {
			ram_used: load.ram_used,
			ram_total: load.ram_total,
			cpu: load.cpu,
			ramPct: Math.round(load.ramPct),
			load: load.load,
			cpus: load.cpus,
			containers,
			net_rx: net.rxMbps,
			net_tx: net.txMbps,
			net_mbps: net.mbps
		}
	};
}

export async function getCalendar(days = 3) {
	try {
		const tokenPath = process.env.GOOGLE_TOKEN_PATH || '/home/das/.hermes/google_token.json';
		const rawToken = readFileSync(tokenPath, 'utf8');
		const token = JSON.parse(rawToken);
		const now = new Date();
		const end = new Date();
		end.setDate(now.getDate() + parseInt(days, 10));
		end.setHours(23, 59, 59, 999);
		const timeMin = now.toISOString();
		const timeMax = end.toISOString();
		const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=250`;
		const r = await fetch(url, {
			headers: { Authorization: `Bearer ${token.access_token || token.token}` }
		});
		if (!r.ok) throw new Error(`calendar ${r.status}`);
		const d = await r.json();
		const rawEvents = (d.items || []).map((e) => ({
			id: e.id,
			title: e.summary || '(no title)',
			start: e.start?.dateTime || e.start?.date,
			end: e.end?.dateTime || e.end?.date,
			location: e.location || '',
			description: e.description || '',
			hw: /(^|\s)#hw(\s|$)/i.test(`${e.summary || ''} ${e.description || ''}`)
		}));
		const events = rawEvents.filter((e) => {
			const text = `${e.title || ''} ${e.description || ''}`.toLowerCase();
			const workKeywords = /\b(hw|homework|assignment|bookwork|worksheet|handout|project|presentation|powerpoint|quiz|test|exam|midterm|final|study|review|notes|replies|discussion|essay|paper|lab|report|due)\b/;
			return workKeywords.test(text);
		});
		return { events, total: rawEvents.length };
	} catch (e) {
		console.error('calendar error:', e.message);
		return { events: [] };
	}
}

// Free, keyless synced-lyrics lookup (lrclib.net). Matching lives in lyrics.js
// so a same-title hit for the wrong artist never reaches the Music view.

async function readMprisNowPlaying() {
	const status = (await run('playerctl status 2>/dev/null')) || 'Not available';
	if (!status.includes('Playing') && !status.includes('Paused')) {
		return { playing: false };
	}
	const [artist, title, album, art, posStr, lenStr] = await Promise.all([
		run('playerctl metadata xesam:artist 2>/dev/null'),
		run('playerctl metadata xesam:title 2>/dev/null'),
		run('playerctl metadata xesam:album 2>/dev/null'),
		run('playerctl metadata mpris:artUrl 2>/dev/null'),
		run('playerctl position 2>/dev/null'),
		run('playerctl metadata mpris:length 2>/dev/null')
	]);
	const length = parseInt(lenStr || '0', 10) / 1_000_000 || 0;
	return {
		playing: status.includes('Playing'),
		artist: artist || 'Unknown artist',
		title: title || 'Unknown title',
		album: album || '',
		art: art || '',
		position: parseFloat(posStr || '0') || 0,
		positionAt: Date.now(),
		length
	};
}

export async function getNowPlaying({ skipLyrics = false } = {}) {
	try {
		const bluetoothConnected = await isBluetoothDeviceConnected();
		// No point shelling out to playerctl for a Bluetooth-sourced player
		// when nothing's actually connected - mergeNowPlaying would discard
		// the result anyway.
		const mpris = bluetoothConnected ? await readMprisNowPlaying() : null;
		const merged = mergeNowPlaying(mpris, readAirplayNowPlaying(), { bluetoothConnected });
		if (!merged.playing && !merged.title) {
			return { playing: false };
		}
		if (skipLyrics) return merged;
		const validTrack =
			merged.artist && merged.title && merged.artist !== 'Unknown artist' && merged.title !== 'Unknown title';
		// Both the iTunes duration lookup and the lyrics fetch are network
		// calls - awaiting either here would delay every field in this
		// response (title/artist/art included) by however long they take,
		// which is what made the display look slow to notice a track change.
		// Serve whatever's already cached and kick off a background refresh
		// on a miss instead; the rest catches up within a poll or two.
		let duration = Number(merged.length) || 0;
		if (!duration && validTrack) {
			duration = peekTrackDuration(merged.artist, merged.title, merged.album || '') || 0;
			if (!duration) ensureTrackDurationCached(merged.artist, merged.title, { album: merged.album || '' });
		}
		let lyrics = null;
		let lyricsPending = false;
		let lyricsSource = null;
		if (validTrack) {
			const peeked = peekLyricsInfo(merged.artist, merged.title, merged.album || '', duration);
			const fp = trackFingerprint(merged.artist, merged.title, duration);
			cancelOtherAlignments(fp);
			const aligned = readCachedAlignmentInfo(fp);
			const pick = getLyricPick(lyricsCacheKey(merged.artist, merged.title, merged.album || '', duration));
			({ lyrics, source: lyricsSource } = pickDisplayLyrics({ community: peeked, aligned, pick }));
			if (!peeked.known) {
				lyricsPending = true;
				ensureLyricsCached(merged.artist, merged.title, { album: merged.album || '', duration });
			} else if (peeked.plainText) {
				// Every fetched track gets an on-device pass when a frame-accurate
				// aligner is installed; with only the energy stand-in this is
				// limited to tracks nobody published word clocks for. The
				// decision itself lives in forcedAlign.shouldAlign().
				ensureAlignedLyrics({
					artist: merged.artist,
					title: merged.title,
					duration,
					plainLyrics: peeked.plainText,
					position: merged.position,
					communityWordLevel: peeked.wordLevel
				});
			}
		}
		return { ...merged, length: merged.length || duration || 0, lyrics, lyricsPending, lyricsSource };
	} catch {
		return { playing: false };
	}
}

/** Chooses what the Music view paints from the two caches. A per-song
 *  remote pick wins. Otherwise a precise on-device alignment (Qwen3 / MMS
 *  / MFA / aeneas) beats everything unless its clocks collapsed onto a
 *  handful of timestamps; a community word-level file beats an
 *  energy-envelope guess; an energy guess beats synthesized per-line
 *  timing; anything beats nothing. */
function alignedLinesForDisplay(aligned, community) {
	return overlayCommunityText(aligned?.lines || null, community?.lines || null);
}

export function pickDisplayLyrics({ community, aligned, pick } = {}) {
	const communityLines = community?.lines || null;
	const communityWordLevel = Boolean(communityLines) && (Boolean(community?.wordLevel) || hasRealWordTiming(communityLines));
	const alignedLines = alignedLinesForDisplay(aligned, community);
	const alignedUsable =
		Boolean(alignedLines) &&
		hasRealWordTiming(alignedLines) &&
		!isCollapsedAlignment(aligned?.lines || alignedLines);
	const wanted = String(pick?.displaySource || '').trim();
	if (wanted) {
		if (wanted.startsWith('align:') && alignedLines) {
			return { lyrics: alignedLines, source: `align:${aligned.engine || wanted.slice(6)}` };
		}
		if (communityLines && !wanted.startsWith('align:')) {
			return { lyrics: communityLines, source: community?.source || wanted };
		}
	}
	if (alignedUsable && aligned.precise) {
		return { lyrics: alignedLines, source: `align:${aligned.engine || 'precise'}` };
	}
	if (communityWordLevel) {
		return { lyrics: communityLines, source: community?.source || 'community' };
	}
	if (alignedUsable) {
		return { lyrics: alignedLines, source: `align:${aligned.engine || 'energy'}` };
	}
	if (communityLines) return { lyrics: communityLines, source: community?.source || null };
	if (alignedLines) {
		return { lyrics: alignedLines, source: `align:${aligned.engine || 'unknown'}` };
	}
	return { lyrics: null, source: null };
}

/** `?demo=music` preview: Radiohead / No Surprises, lyrics from the same
 *  community lookup a live track uses. Clock/position stay with the client. */
export function getDemoNowPlaying() {
	const { artist, title, album, length } = DEMO_TRACK;
	const peeked = peekLyricsInfo(artist, title, album, length);
	if (!peeked.known) ensureLyricsCached(artist, title, { album, duration: length });
	const fp = trackFingerprint(artist, title, length);
	const aligned = readCachedAlignmentInfo(fp);
	const pick = getLyricPick(lyricsCacheKey(artist, title, album, length));
	const { lyrics, source } = pickDisplayLyrics({ community: peeked, aligned, pick });
	return demoNowPlaying(undefined, {
		lyrics,
		lyricsPending: !peeked.known,
		lyricsSource: source
	});
}

export function getVoiceDemoNowPlaying(position, freeze) {
	return voiceDemoNowPlaying(undefined, { position, freeze });
}

/** Parse `git status -sb` tracking, e.g. `## master...origin/master [behind 2]`. */
export function parseGitAheadBehind(statusSb = '') {
	const line = String(statusSb).split('\n')[0] || '';
	const ahead = /ahead (\d+)/.exec(line);
	const behind = /behind (\d+)/.exec(line);
	return {
		ahead: ahead ? parseInt(ahead[1], 10) : 0,
		behind: behind ? parseInt(behind[1], 10) : 0
	};
}

export async function getGitContext() {
	const cwd = process.env.GIT_STATUS_DIR || process.cwd();
	const opts = `git -C ${JSON.stringify(cwd)}`;
	const [branch, message, shortSha, dirtyRaw, aheadBehind, commitFilesRaw] = await Promise.all([
		run(`${opts} rev-parse --abbrev-ref HEAD 2>/dev/null`),
		run(`${opts} log -1 --pretty=%s 2>/dev/null`),
		run(`${opts} rev-parse --short HEAD 2>/dev/null`),
		run(`${opts} status --porcelain 2>/dev/null`),
		run(`${opts} status -sb 2>/dev/null`),
		run(`${opts} diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null`)
	]);
	const tracking = parseGitAheadBehind(aheadBehind || '');
	const files = dirtyRaw
		? dirtyRaw
				.split('\n')
				.filter(Boolean)
				.slice(0, 8)
				.map((line) => ({
					code: line.slice(0, 2).trim(),
					path: line.slice(3)
				}))
		: [];
	const commitFiles = commitFilesRaw
		? commitFilesRaw.split('\n').filter(Boolean).slice(0, 8)
		: [];
	return {
		branch: branch || 'unknown',
		message: message || 'no commits',
		sha: shortSha || '',
		dirty: Boolean(dirtyRaw),
		status: aheadBehind || '',
		ahead: tracking.ahead,
		behind: tracking.behind,
		changed: dirtyRaw ? dirtyRaw.split('\n').filter(Boolean).length : 0,
		files,
		commitFiles
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

const STATION_DIR = process.env.STATION_DIR || '/home/das/projects/smart-display/.station';
const STATION_FILE = path.join(STATION_DIR, 'latest.json');
const STATION_HISTORY = path.join(STATION_DIR, 'history.jsonl');
let lastStation = null;
let lastStationTime = 0;

try {
	if (!existsSync(STATION_DIR)) mkdirSync(STATION_DIR, { recursive: true });
} catch {
	/* build hosts cannot write the kiosk station dir */
}

function tryParseNum(v) {
	if (v === undefined || v === null) return null;
	const n = Number(v);
	return Number.isNaN(n) ? null : n;
}

export function saveStationData(raw) {
	try {
		const data = {
			tempf: tryParseNum(raw.tempf ?? raw.outTemp ?? raw.temperature ?? raw.temp),
			humidity: tryParseNum(raw.humidity ?? raw.outHumidity ?? raw.humidityin),
			winddir: tryParseNum(raw.winddir ?? raw.windDir),
			windspeedmph: tryParseNum(raw.windspeedmph ?? raw.windSpeed ?? raw.windspeed),
			windgustmph: tryParseNum(raw.windgustmph ?? raw.windGust ?? raw.windgust),
			baromrelin: tryParseNum(raw.baromrelin),
			baromabsin: tryParseNum(raw.baromabsin ?? raw.barometer ?? raw.pressure),
			rainin: tryParseNum(raw.rainin ?? raw.hourlyrainin ?? raw.dailyrainin ?? raw.rain),
			dailyrainin: tryParseNum(raw.dailyrainin ?? raw.dailyrain),
			uv: tryParseNum(raw.uv ?? raw.uvIndex),
			solarradiation: tryParseNum(raw.solarradiation),
			mac: raw.mac ?? raw.stationID ?? raw.stationType ?? null,
			ts: Date.now()
		};
		writeFileSync(STATION_FILE, JSON.stringify(data));
		writeFileSync(STATION_HISTORY, `${JSON.stringify(data)}\n`, { flag: 'a' });

		// rotate history to last 7 days
		try {
			const lines = readFileSync(STATION_HISTORY, 'utf8').trim().split('\n').filter(Boolean);
			const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
			const kept = lines.filter((line) => {
				const obj = JSON.parse(line);
				return (obj.ts || 0) > cutoff;
			});
			if (kept.length < lines.length) {
				writeFileSync(STATION_HISTORY, kept.map((l) => `${l}\n`).join(''));
			}
		} catch {
			/* ignore rotation errors */
		}

		lastStation = data;
		lastStationTime = data.ts;
		return data;
	} catch (e) {
		console.error('saveStationData error:', e.message);
		throw e;
	}
}

function loadStation() {
	try {
		if (lastStation && Date.now() - lastStationTime < 60000) return lastStation;
		const raw = readFileSync(STATION_FILE, 'utf8');
		const data = JSON.parse(raw);
		lastStation = data;
		lastStationTime = Date.now();
		return data;
	} catch {
		return null;
	}
}

function loadStationHistory(hours = 2) {
	try {
		const cutoff = Date.now() - hours * 60 * 60 * 1000;
		const lines = readFileSync(STATION_HISTORY, 'utf8').trim().split('\n').filter(Boolean);
		const out = [];
		for (const line of lines.slice(-5000)) {
			try {
				const obj = JSON.parse(line);
				if ((obj.ts || 0) > cutoff) out.push(obj);
			} catch {
				continue;
			}
		}
		return out;
	} catch {
		return [];
	}
}

const WEATHER_LAT = LARGO_LAT;
const WEATHER_LON = LARGO_LON;
const RAINVIEWER_CACHE_TTL = 300_000;
let rainViewerCache = { ts: 0, data: null };

async function getRainViewer() {
	const now = Date.now();
	if (now - rainViewerCache.ts < RAINVIEWER_CACHE_TTL && rainViewerCache.data) {
		return rainViewerCache.data;
	}
	try {
		const r = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) throw new Error(`rainviewer ${r.status}`);
		const d = await r.json();
		rainViewerCache = { ts: now, data: d };
		return d;
	} catch (e) {
		console.error('rainviewer error:', e.message);
		return null;
	}
}

async function getNWSAlerts() {
	try {
		const r = await fetch(
			`https://api.weather.gov/alerts/active?point=${WEATHER_LAT},${WEATHER_LON}`,
			{ signal: AbortSignal.timeout(5000) }
		);
		if (!r.ok) throw new Error(`nws ${r.status}`);
		const d = await r.json();
		return (d.features || []).map((a) => ({
			event: a.properties?.event || 'Alert',
			severity: a.properties?.severity || 'Unknown',
			headline: a.properties?.headline || '',
			description: a.properties?.description || '',
			onset: a.properties?.onset,
			ends: a.properties?.ends
		}));
	} catch (e) {
		console.error('nws alerts error:', e.message);
		return [];
	}
}

function wmoLabel(code) {
	if (code <= 1) return 'Clear';
	if (code <= 3) return 'Cloudy';
	if (code <= 48) return 'Fog';
	if (code <= 67) return 'Rain';
	if (code <= 77) return 'Snow';
	if (code <= 82) return 'Showers';
	if (code <= 86) return 'Snow';
	if (code <= 99) return 'Storm';
	return 'Fair';
}

export async function getWeather(hours = 48) {
	try {
		const days = Math.max(1, Math.ceil(hours / 24));
		const openMeteoUrl =
			`https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
			`&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,is_day` +
			`&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,rain,showers,weather_code,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
			`&minutely_15=precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m` +
			`&daily=sunrise,sunset,uv_index_max` +
			`&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/New_York&forecast_days=${days}`;
		const [openMeteo, radarMeta, alerts, nearby] = await Promise.all([
			fetch(openMeteoUrl, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
			getRainViewer(),
			getNWSAlerts(),
			fetchAmbientStations(WEATHER_LAT, WEATHER_LON).catch(() => [])
		]);

		const station = loadStation();
		const stationHistory = loadStationHistory(2);
		const stationFresh = station && Date.now() - station.ts < 10 * 60 * 1000;
		const home = { lat: WEATHER_LAT, lon: WEATHER_LON };
		const meshSamples = [...(nearby || [])];
		if (stationFresh) {
			const yard = backyardToSample(station, home);
			if (yard) meshSamples.push(yard);
		}
		const mesh = estimateAt(meshSamples, home, Date.now());

		const current = openMeteo?.current || {};
		const hourlyRaw = openMeteo?.hourly || {};
		const hourly = [];
		for (let i = 0; i < (hourlyRaw.time?.length || 0); i++) {
			hourly.push({
				time: hourlyRaw.time[i],
				temp: hourlyRaw.temperature_2m?.[i],
				humidity: hourlyRaw.relative_humidity_2m?.[i],
				precipitation_probability: hourlyRaw.precipitation_probability?.[i],
				precipitation: hourlyRaw.precipitation?.[i],
				rain: hourlyRaw.rain?.[i],
				showers: hourlyRaw.showers?.[i],
				weather_code: hourlyRaw.weather_code?.[i],
				pressure: hourlyRaw.pressure_msl?.[i],
				cloud_cover: hourlyRaw.cloud_cover?.[i],
				wind_speed: hourlyRaw.wind_speed_10m?.[i],
				wind_direction: hourlyRaw.wind_direction_10m?.[i],
				wind_gusts: hourlyRaw.wind_gusts_10m?.[i]
			});
		}

		const minuteRaw = openMeteo?.minutely_15 || {};
		const minutely = [];
		for (let i = 0; i < (minuteRaw.time?.length || 0); i++) {
			minutely.push({
				time: minuteRaw.time[i],
				precipitation: minuteRaw.precipitation?.[i],
				rain: minuteRaw.rain?.[i],
				weather_code: minuteRaw.weather_code?.[i],
				wind_speed: minuteRaw.wind_speed_10m?.[i],
				wind_direction: minuteRaw.wind_direction_10m?.[i]
			});
		}

		const dailyRaw = openMeteo?.daily || {};
		const sun = {
			sunrise: dailyRaw.sunrise?.[0] || null,
			sunset: dailyRaw.sunset?.[0] || null,
			uvMax: dailyRaw.uv_index_max?.[0] ?? null
		};

		const prediction = fuseRainPrediction({
			hourly,
			minutely,
			stationHistory: stationFresh ? stationHistory : [],
			nowMs: Date.now()
		});

		const currentOut = applyMeshToCurrent(
			{
				temp: current.temperature_2m,
				feelsLike: current.apparent_temperature,
				humidity: current.relative_humidity_2m,
				precipitation: current.precipitation,
				rain: current.rain,
				showers: current.showers,
				weatherCode: current.weather_code,
				desc: wmoLabel(current.weather_code),
				cloudCover: current.cloud_cover,
				windSpeed: current.wind_speed_10m,
				windDirection: current.wind_direction_10m,
				windGusts: current.wind_gusts_10m,
				pressure: current.pressure_msl,
				isDay: current.is_day,
				uv: stationFresh ? station.uv : null,
				solar: stationFresh ? station.solarradiation : null
			},
			mesh
		);

		const radarFrames = [];
		if (radarMeta?.radar?.past) {
			for (const frame of radarMeta.radar.past) {
				radarFrames.push({ ts: frame.time * 1000, urlTemplate: frame.path, nowcast: false });
			}
		}
		if (radarMeta?.radar?.nowcast) {
			for (const frame of radarMeta.radar.nowcast) {
				radarFrames.push({ ts: frame.time * 1000, urlTemplate: frame.path, nowcast: true });
			}
		}
		const colorScheme = radarMeta?.radar?.colorScheme ?? 2;
		const host = radarMeta?.host ?? 'https://tilecache.rainviewer.com';

		return {
			current: currentOut,
			hourly,
			minutely,
			sun,
			rad: { host, frames: radarFrames, colorScheme, lat: WEATHER_LAT, lon: WEATHER_LON },
			alerts,
			prediction,
			station: stationFresh ? station : null,
			mesh,
			fetchedAt: new Date().toISOString()
		};
	} catch (e) {
		console.error('weather error:', e.message);
		return {
			current: { temp: '--', desc: '--', humidity: '--', windSpeed: '--', pressure: '--' },
			hourly: [],
			minutely: [],
			sun: { sunrise: null, sunset: null, uvMax: null },
			rad: { host: '', frames: [], colorScheme: 2, lat: WEATHER_LAT, lon: WEATHER_LON },
			alerts: [],
			prediction: {
				rain30min: 0,
				rain60min: 0,
				rain120min: 0,
				source: 'forecast',
				etaMin: null,
				approaching: false
			},
			mesh: { method: 'none', stationCount: 0 },
			error: e.message
		};
	}
}

