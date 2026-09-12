import { readFileSync } from 'node:fs';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fuseRainPrediction } from '../rainModel.js';
import { mergeNowPlaying, readAirplayNowPlaying } from './audioNowPlaying.js';

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
			const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
			return { name, status: r.ok, uptime };
		} catch {
			return { name, status: false, uptime: 'down' };
		}
	}

	const services = await Promise.all([
		check('https://dasdev.net', 'dasdev.net', '99.9%'),
		check('https://godmode.dasdev.net', 'godmode', '100%'),
		check('https://leadvine.dasdev.net', 'leadvine', '100%'),
		check('https://hermes.dasdev.net', 'hermes', '100%'),
		check('http://127.0.0.1:8123/api/', 'home assistant', '100%'),
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

// Free, keyless synced-lyrics lookup (lrclib.net) — works for whatever's
// actually playing via MPRIS/playerctl, regardless of source app (Apple
// Music, Spotify, anything). Cached per artist+title: long TTL on a hit
// since lyrics never change, short TTL on a miss so a bad match (e.g. a
// title playerctl hasn't fully populated yet) gets retried soon.
const LYRICS_HIT_TTL = 6 * 60 * 60 * 1000;
const LYRICS_MISS_TTL = 90 * 1000;
const lyricsCache = new Map();

function parseLRC(text) {
	const timeTag = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
	const lines = [];
	for (const raw of text.split('\n')) {
		const matches = [...raw.matchAll(timeTag)];
		if (!matches.length) continue;
		const content = raw.replace(timeTag, '').trim();
		for (const m of matches) {
			lines.push({ time: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: content });
		}
	}
	return lines.sort((a, b) => a.time - b.time);
}

async function fetchLyrics(artist, title, durationSec) {
	const key = `${artist}|${title}`.toLowerCase();
	const cached = lyricsCache.get(key);
	if (cached && Date.now() - cached.fetchedAt < cached.ttl) return cached.lines;
	try {
		const params = new URLSearchParams({ artist_name: artist, track_name: title });
		if (durationSec) params.set('duration', String(Math.round(durationSec)));
		const r = await fetch(`https://lrclib.net/api/get?${params}`, {
			signal: AbortSignal.timeout(4000)
		});
		if (!r.ok) throw new Error(`lrclib ${r.status}`);
		const d = await r.json();
		const lines = d.syncedLyrics
			? parseLRC(d.syncedLyrics)
			: d.plainLyrics
				? [{ time: 0, text: d.plainLyrics }]
				: null;
		lyricsCache.set(key, { lines, fetchedAt: Date.now(), ttl: lines ? LYRICS_HIT_TTL : LYRICS_MISS_TTL });
		return lines;
	} catch (e) {
		console.error('lyrics fetch error:', e.message);
		lyricsCache.set(key, { lines: null, fetchedAt: Date.now(), ttl: LYRICS_MISS_TTL });
		return null;
	}
}

function readMprisNowPlaying() {
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
	const length = parseInt(lenStr, 10) / 1_000_000 || 0;
	return {
		playing: status.includes('Playing'),
		artist,
		title,
		album,
		art,
		position: parseFloat(posStr),
		length
	};
}

export async function getNowPlaying() {
	try {
		const merged = mergeNowPlaying(readMprisNowPlaying(), readAirplayNowPlaying());
		if (!merged.playing && !merged.title) {
			return { playing: false };
		}
		const lyrics =
			merged.artist &&
			merged.title &&
			merged.artist !== 'Unknown artist' &&
			merged.title !== 'Unknown title'
				? await fetchLyrics(merged.artist, merged.title, merged.length)
				: null;
		return { ...merged, lyrics };
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
	const commitFilesRaw = run(`${opts} diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null`);
	const commitFiles = commitFilesRaw
		? commitFilesRaw.split('\n').filter(Boolean).slice(0, 8)
		: [];
	return {
		branch: branch || 'unknown',
		message: message || 'no commits',
		sha: shortSha || '',
		dirty: Boolean(dirtyRaw),
		status: aheadBehind || '',
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

const WEATHER_LAT = 27.9097;
const WEATHER_LON = -82.7873;
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
		const [openMeteo, radarMeta, alerts] = await Promise.all([
			fetch(openMeteoUrl, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
			getRainViewer(),
			getNWSAlerts()
		]);

		const station = loadStation();
		const stationHistory = loadStationHistory(2);
		const stationFresh = station && Date.now() - station.ts < 10 * 60 * 1000;

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

		const currentOut = stationFresh
			? {
					temp: station.tempf ?? current.temperature_2m,
					feelsLike: current.apparent_temperature,
					humidity: station.humidity ?? current.relative_humidity_2m,
					precipitation: current.precipitation,
					rain: station.rainin ?? current.rain,
					showers: current.showers,
					weatherCode: current.weather_code,
					desc: wmoLabel(current.weather_code),
					cloudCover: current.cloud_cover,
					windSpeed: station.windspeedmph ?? current.wind_speed_10m,
					windDirection: station.winddir ?? current.wind_direction_10m,
					windGusts: station.windgustmph ?? current.wind_gusts_10m,
					pressure: station.baromabsin ?? current.pressure_msl,
					isDay: current.is_day,
					uv: station.uv,
					solar: station.solarradiation
				}
			: {
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
					isDay: current.is_day
				};

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
			error: e.message
		};
	}
}

