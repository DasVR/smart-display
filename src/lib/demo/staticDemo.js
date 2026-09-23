/**
 * Static demo for GitHub Pages. The real kiosk talks to a Node server
 * (`/api/*` over HTTP, `/ws` for live events). On Pages there is no server,
 * so when the build sets VITE_STATIC_DEMO=1 this module stands in for it:
 *
 *  - `fetch()` calls to `/api/...` get canned JSON shaped exactly like the
 *    real endpoints (weather is generated around the current time so the
 *    forecast, sun times and radar never look stale);
 *  - `WebSocket` to `/ws` is a fake socket that sends the server's `init`
 *    frame, echoes `navigate` like the server does, and streams a gentle
 *    audio spectrum so the trough waveform moves.
 *
 * Nothing here is the owner's real data. The location is a public city,
 * services and agents are generic, and the demo track's lyrics are
 * original lines written for this demo (the repo never ships copyrighted
 * lyrics).
 */

// Chicago: a public, well-covered radar location, not the kiosk's home.
const DEMO_LAT = 41.8781;
const DEMO_LON = -87.6298;

const pad = (n) => String(n).padStart(2, '0');
function localIso(d) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Radar frames from RainViewer's public index, mapped to the kiosk's shape. */
async function liveRadarFrames(realFetch) {
	try {
		const r = await realFetch('https://api.rainviewer.com/public/weather-maps.json');
		if (!r.ok) return { host: 'https://tilecache.rainviewer.com', frames: [] };
		const j = await r.json();
		const past = (j.radar?.past || []).map((f) => ({ ts: f.time * 1000, urlTemplate: f.path, nowcast: false }));
		const cast = (j.radar?.nowcast || []).map((f) => ({ ts: f.time * 1000, urlTemplate: f.path, nowcast: true }));
		return { host: j.host || 'https://tilecache.rainviewer.com', frames: [...past, ...cast] };
	} catch {
		return { host: 'https://tilecache.rainviewer.com', frames: [] };
	}
}

async function demoWeather(realFetch, hours = 48) {
	const now = new Date();
	const start = new Date(now);
	start.setMinutes(0, 0, 0);
	const hourly = [];
	for (let i = 0; i < hours; i++) {
		const t = new Date(start.getTime() + i * 3600_000);
		const h = t.getHours();
		// warm afternoons, cool nights; a passing shower mid-afternoon
		const temp = 64 + 12 * Math.sin(((h - 9) / 24) * Math.PI * 2);
		const pop = h >= 14 && h <= 17 ? 45 : 8;
		hourly.push({
			time: localIso(t),
			temp: Math.round(temp * 10) / 10,
			humidity: 62,
			precipitation_probability: pop,
			precipitation: pop > 40 ? 0.02 : 0,
			rain: pop > 40 ? 0.02 : 0,
			showers: 0,
			weather_code: pop > 40 ? 61 : 2,
			pressure: 1015.2,
			cloud_cover: pop > 40 ? 80 : 35,
			wind_speed: 7.5,
			wind_direction: 240,
			wind_gusts: 14
		});
	}
	const minutely = [];
	for (let i = 0; i < 192; i++) {
		const t = new Date(start.getTime() + i * 15 * 60_000);
		minutely.push({ time: localIso(t), precipitation: 0, rain: 0, weather_code: 2, wind_speed: 7.5, wind_direction: 240 });
	}
	const cur = hourly[0];
	const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const radar = await liveRadarFrames(realFetch);
	const mesh = {
		temp: cur.temp,
		humidity: 62,
		pressureHpa: 1015.2,
		windSpeed: 7.5,
		windDirection: 240,
		windGusts: 14,
		rain: 0,
		stationCount: 48,
		method: 'triangle'
	};
	return {
		current: {
			temp: cur.temp,
			feelsLike: cur.temp + 1.5,
			humidity: 62,
			precipitation: 0,
			rain: 0,
			showers: 0,
			weatherCode: 2,
			desc: 'Partly cloudy',
			cloudCover: 35,
			windSpeed: 7.5,
			windDirection: 240,
			windGusts: 14,
			pressure: 1015.2,
			isDay: now.getHours() >= 7 && now.getHours() < 19 ? 1 : 0,
			uv: null,
			solar: null,
			mesh
		},
		hourly,
		minutely,
		sun: { sunrise: `${day}T06:52`, sunset: `${day}T18:41`, uvMax: 5.1 },
		rad: { host: radar.host, frames: radar.frames, colorScheme: 2, lat: DEMO_LAT, lon: DEMO_LON },
		alerts: [],
		prediction: { rain30min: 0, rain60min: 0.04, rain120min: 0.08, source: 'minutely+forecast', etaMin: null, approaching: false },
		station: null,
		mesh,
		fetchedAt: now.toISOString()
	};
}

function demoCalendar() {
	const at = (dayOffset, hour, minute = 0) => {
		const d = new Date();
		d.setDate(d.getDate() + dayOffset);
		d.setHours(hour, minute, 0, 0);
		return d.toISOString();
	};
	return {
		events: [
			{ id: 'd1', title: 'Physics lab report', start: at(0, 23, 59), location: 'Physics · #hw' },
			{ id: 'd2', title: 'Calculus problem set 4', start: at(1, 9, 0), location: 'Calculus · #hw' },
			{ id: 'd3', title: 'Essay draft: unreliable narrators', start: at(2, 17, 0), location: 'English · #hw' },
			{ id: 'd4', title: 'Spanish vocab quiz', start: at(4, 8, 30), location: 'Spanish · #hw' }
		]
	};
}

const TELEMETRY = {
	services: [
		{ name: 'home server', status: true, uptime: '99.9%' },
		{ name: 'media box', status: true, uptime: '99.4%' },
		{ name: 'home assistant', status: true, uptime: '100%' },
		{ name: 'backup nas', status: false, uptime: 'down' },
		{ name: 'display', status: true, uptime: '100%' }
	],
	stats: { ram_used: 5.2, ram_total: 15.7, cpu: 18, ramPct: 33, load: 0.9, cpus: 4, containers: 6, net_rx: 0, net_tx: 0, net_mbps: 2.4 }
};

const LOAD = {
	cpu: 18, cpuReady: true, load: 0.9, cpus: 4, ram_used: 5.2, ram_total: 15.7, ramPct: 33,
	type: 'load', quality: 'full', freeze: false, inferring: false, installing: false, reasons: []
};

const AGENTS = {
	agents: [
		{ id: 'claude', name: 'Claude Code', phase: 'working', task: 'Polishing the demo', source: 'Claude Code', body: 'Building the GitHub Pages demo', lastEvent: 'working', updatedAt: Date.now() },
		{ id: 'cursor', name: 'Cursor', phase: 'done', task: 'PR checks green', source: 'Cursor', body: '', lastEvent: 'done', updatedAt: Date.now() - 600_000 },
		{ id: 'hermes', name: 'Hermes', phase: 'idle', task: 'standby', source: 'Hermes', body: '', lastEvent: '', updatedAt: 0 },
		{ id: 'ollama', name: 'Ollama', phase: 'idle', task: 'standby', source: 'Ollama', body: '', lastEvent: '', updatedAt: 0 }
	]
};

const IDLE_PROGRESS = {
	type: 'installProgress', active: false, phase: 'idle', title: '', current: '', lastCompleted: '',
	completed: [], done: 0, total: 0, percent: 0, error: ''
};

const UPDATES = {
	packages: 0, security: 0, firmware: 0, firmwareNames: [], installing: false, packagesInstalling: false,
	firmwareInstalling: false, rebootRequired: false, rebootPkgs: [], available: false, source: 'demo',
	progress: IDLE_PROGRESS
};

/** Original lines written for this demo, timed word by word. */
const DEMO_LINES = [
	[25.7, 'Streetlights hum a quiet song'],
	[31.2, 'Rain is drawing on the glass'],
	[36.8, 'Every minute folds in half'],
	[42.3, 'Hold the light before it goes'],
	[48.0, 'Silver rivers on the floor'],
	[53.6, 'Nothing moves but you and me'],
	[59.1, 'Count the colours as they fall'],
	[64.7, 'Stay until the morning comes']
];
function demoLyrics() {
	return DEMO_LINES.map(([time, text], i) => {
		const end = DEMO_LINES[i + 1]?.[0] ?? time + 5.5;
		const words = text.split(' ');
		const step = (end - time - 0.6) / words.length;
		return {
			time,
			end,
			text,
			words: words.map((w, j) => ({ time: +(time + j * step).toFixed(3), text: w, end: +(time + (j + 1) * step).toFixed(3) }))
		};
	});
}

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function apiPath(input) {
	try {
		const url = new URL(typeof input === 'string' ? input : input.url, location.href);
		if (url.origin !== location.origin) return null;
		const i = url.pathname.indexOf('/api/');
		return i === -1 ? null : { path: url.pathname.slice(i + 5), url };
	} catch {
		return null;
	}
}

class DemoSocket extends EventTarget {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	constructor(url) {
		super();
		this.url = url;
		this.readyState = 0;
		this.onopen = this.onmessage = this.onclose = this.onerror = null;
		this.view = 'clock';
		setTimeout(() => {
			this.readyState = 1;
			this.#emit('open');
			this.#push({
				type: 'init',
				view: this.view,
				display: { hdmi: 'on' },
				agents: AGENTS.agents,
				power: 'HIGH_PERFORMANCE',
				load: LOAD,
				installProgress: IDLE_PROGRESS
			});
			this.spectrum = setInterval(() => this.#spectrumFrame(), 110);
		}, 60);
	}
	#emit(type, data) {
		const ev = type === 'message' ? new MessageEvent('message', { data }) : new Event(type);
		this[`on${type}`]?.(ev);
		this.dispatchEvent(ev);
	}
	#push(msg) {
		if (this.readyState === 1) this.#emit('message', JSON.stringify(msg));
	}
	#spectrumFrame() {
		const t = performance.now() / 1000;
		const bins = Array.from({ length: 32 }, (_, i) =>
			Math.max(0.05, 0.35 * (1 - i / 40) + 0.25 * Math.sin(t * 2.1 + i * 0.7) * Math.sin(t * 0.9 + i * 0.3))
		);
		this.#push({ type: 'audioSpectrum', bass: 0.3 + 0.2 * Math.sin(t * 2.4), bins });
	}
	send(raw) {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		// the server rebroadcasts navigation to every client, sender included
		if (msg.type === 'navigate' && msg.view) {
			this.view = msg.view;
			setTimeout(() => this.#push({ type: 'navigate', view: msg.view, from: 'local' }), 30);
		}
	}
	close() {
		clearInterval(this.spectrum);
		this.readyState = 3;
	}
}

export function installStaticDemo() {
	if (typeof window === 'undefined' || window.__staticDemo) return;
	window.__staticDemo = true;
	const realFetch = window.fetch.bind(window);
	const RealSocket = window.WebSocket;

	window.fetch = async (input, init) => {
		const hit = apiPath(input);
		if (!hit) return realFetch(input, init);
		const { path, url } = hit;
		if (path.startsWith('weather/station')) return json({ station: null });
		if (path.startsWith('weather')) return json(await demoWeather(realFetch, Number(url.searchParams.get('hours')) || 48));
		if (path.startsWith('calendar')) return json(demoCalendar());
		if (path.startsWith('telemetry')) return json(TELEMETRY);
		if (path.startsWith('load')) return json(LOAD);
		if (path.startsWith('agents')) return json(AGENTS);
		if (path.startsWith('updates')) return json(UPDATES);
		if (path.startsWith('ollama')) return json({ models: [] });
		if (path.startsWith('nowplaying')) {
			// only the ?demo=music preview asks for lyrics; otherwise nothing is playing
			if (url.searchParams.get('demo')) {
				return json({ lyrics: demoLyrics(), lyricsPending: false, lyricsSource: 'demo' });
			}
			return json({ playing: false, paused: false, title: '', artist: '' });
		}
		if (path.startsWith('display')) return json({ hdmi: 'on', schedule: { enabled: false }, quiet: false, hold: null });
		if (path.startsWith('volume')) return json({ volume: 0.6, muted: false });
		if (path.startsWith('git')) return json({ branch: 'master', sha: 'demo', dirty: false, changed: 0, files: [], commitFiles: [] });
		// player controls, notify, etc: accept and do nothing
		return json({ ok: true });
	};

	window.WebSocket = function (url, protocols) {
		if (String(url).endsWith('/ws')) return new DemoSocket(url);
		return new RealSocket(url, protocols);
	};
	Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
}
