import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { formatSpeakerReport, parseWpctlStatus, pickSpeakerSink } from './audioSinks.js';
import { readHdmiStamp } from './displayPower.js';
import { getGitContext, getNowPlaying, getTelemetry } from './hostData.js';

const AIRPLAY_UNITS = {
	unit: 'smart-display-airplay.service',
	meta: 'smart-display-airplay-meta.service'
};

function run(cmd, timeout = 3000) {
	try {
		return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (error) {
		const out = String(error.stdout || '').trim();
		return out || null;
	}
}

function runFile(bin, args, opts = {}) {
	const timeout = opts.timeout ?? 3000;
	try {
		return execFileSync(bin, args, {
			encoding: 'utf8',
			timeout,
			stdio: ['ignore', 'pipe', 'pipe'],
			...(opts.env ? { env: opts.env } : {})
		}).trim();
	} catch (error) {
		const out = String(error.stdout || '').trim();
		return out || null;
	}
}

function which(bin, env) {
	const extra = env?.PATH ? `PATH=${JSON.stringify(env.PATH)} ` : '';
	return run(`${extra}command -v ${bin} 2>/dev/null`);
}

export const SHAIRPORT_BINARIES = ['/usr/local/bin/shairport-sync', '/usr/bin/shairport-sync'];

export function findShairportBinary({ exists = existsSync, lookup = which } = {}) {
	for (const candidate of SHAIRPORT_BINARIES) {
		if (exists(candidate)) return candidate;
	}
	return lookup('shairport-sync') || '';
}

export function userSessionEnv({
	uid = typeof process.getuid === 'function' ? process.getuid() : 1000,
	runtimeDir,
	hasBus,
	base = process.env
} = {}) {
	const dir = runtimeDir || base.XDG_RUNTIME_DIR || `/run/user/${uid}`;
	const env = { ...base, XDG_RUNTIME_DIR: dir };
	const busPath = path.join(dir, 'bus');
	const busPresent = typeof hasBus === 'boolean' ? hasBus : existsSync(busPath);
	if (busPresent) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`;
	const parts = String(env.PATH || '/usr/sbin:/usr/bin:/sbin:/bin').split(':');
	if (!parts.includes('/usr/local/bin')) {
		env.PATH = `/usr/local/bin:${env.PATH || '/usr/bin'}`;
	}
	return env;
}

function readText(file) {
	try {
		if (!file || !existsSync(file)) return '';
		return readFileSync(file, 'utf8');
	} catch {
		return '';
	}
}

export function parseSystemctlActive(text) {
	const value = String(text || '')
		.trim()
		.split(/\s+/)[0];
	if (
		value === 'active' ||
		value === 'inactive' ||
		value === 'failed' ||
		value === 'activating' ||
		value === 'deactivating' ||
		value === 'reloading'
	) {
		return value;
	}
	return 'unknown';
}

export function parseShairportVersion(text = '') {
	const raw = String(text || '').trim();
	const version = (raw.match(/^([0-9]+\.[0-9]+(?:\.[0-9]+)?)/) || [])[1] || '';
	return {
		airplay2: /AirPlay2/i.test(raw),
		version
	};
}

export function parseShairportName(confText = '') {
	const m = String(confText).match(/\bname\s*=\s*["']([^"']+)["']/);
	return m ? m[1].trim() : null;
}

export function parseBluetoothShow(text = '') {
	const raw = String(text || '');
	const yes = (label) => new RegExp(`^\\s*${label}:\\s*yes\\b`, 'im').test(raw);
	const alias = (raw.match(/^\s*Alias:\s*(.+)$/m) || [])[1]?.trim() || '';
	const address = (raw.match(/Controller\s+([0-9A-Fa-f:]{17})/) || [])[1] || '';
	return {
		powered: yes('Powered'),
		discoverable: yes('Discoverable'),
		pairable: yes('Pairable'),
		name: alias,
		address
	};
}

export function parseBluetoothDevices(text = '') {
	const devices = [];
	for (const line of String(text || '').split('\n')) {
		const m = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s*(.*)$/);
		if (!m) continue;
		devices.push({ address: m[1], name: (m[2] || '').trim() });
	}
	return devices;
}

export function airplayHint({
	ready,
	installed,
	airplay2,
	unit,
	nqptp,
	avahi,
	name
} = {}) {
	const listed = name || 'Smart Display';
	if (ready) return `Apple Music should list ${listed}`;
	if (!installed) return 'shairport-sync is not installed';
	if (!airplay2) return 'shairport-sync is not AirPlay 2';
	if (unit !== 'active') {
		if (unit === 'unknown') return 'AirPlay unit is not visible';
		return 'AirPlay unit is stopped';
	}
	if (nqptp !== 'active') return 'nqptp is stopped';
	if (avahi !== 'active') return 'Avahi is stopped';
	return 'AirPlay is not ready';
}

export function buildAirplayStatus({
	binary,
	versionText,
	confText,
	unit,
	meta,
	nqptp,
	avahi
} = {}) {
	const parsed = parseShairportVersion(versionText);
	const name = parseShairportName(confText) || 'Smart Display';
	const installed = Boolean(binary);
	const airplay2 = Boolean(parsed.airplay2);
	const ready =
		installed &&
		airplay2 &&
		unit === 'active' &&
		nqptp === 'active' &&
		avahi === 'active';
	return {
		installed,
		airplay2,
		binary: binary || '',
		version: parsed.version,
		name,
		unit: unit || 'unknown',
		meta: meta || 'unknown',
		nqptp: nqptp || 'unknown',
		avahi: avahi || 'unknown',
		ready,
		hint: airplayHint({
			ready,
			installed,
			airplay2,
			unit,
			nqptp,
			avahi,
			name
		})
	};
}

function unitState(unit, { user = false, env } = {}) {
	const args = user ? ['--user', 'is-active', unit] : ['is-active', unit];
	let state = parseSystemctlActive(runFile('systemctl', args, { env: user ? env : undefined }));
	if (user && state === 'unknown') {
		const machine = `${os.userInfo().username}@`;
		state = parseSystemctlActive(
			runFile('systemctl', ['--user', `--machine=${machine}`, 'is-active', unit])
		);
	}
	return state;
}

function processRunning(name, env) {
	return Boolean(runFile('pidof', [name], { env }) || runFile('pgrep', ['-x', name], { env }));
}

function probeAirplay(env) {
	const binary = findShairportBinary({
		lookup: (bin) => which(bin, env)
	});
	const versionText = binary ? runFile(binary, ['-V'], { env }) || '' : '';
	const confPath =
		process.env.SHAIRPORT_CONF || path.join(os.homedir(), '.config/shairport-sync.conf');
	let unit = unitState(AIRPLAY_UNITS.unit, { user: true, env });
	const meta = unitState(AIRPLAY_UNITS.meta, { user: true, env });
	if (unit === 'unknown' && processRunning('shairport-sync', env)) {
		unit = 'active';
	}
	return buildAirplayStatus({
		binary,
		versionText,
		confText: readText(confPath),
		unit,
		meta,
		nqptp: unitState('nqptp.service'),
		avahi: unitState('avahi-daemon.service')
	});
}

function probeBluetooth(env) {
	const show = runFile('bluetoothctl', ['--timeout', '3', 'show'], { env }) || '';
	const connectedText =
		runFile('bluetoothctl', ['--timeout', '3', 'devices', 'Connected'], { env }) || '';
	const adapter = parseBluetoothShow(show);
	const connected = parseBluetoothDevices(connectedText);
	const agent = unitState('smart-display-bt-agent.service');
	const watch = unitState('smart-display-bt-watch.service');
	return {
		...adapter,
		connected,
		agent,
		watch,
		ready: adapter.powered && agent === 'active'
	};
}

function probeSpeakers(env) {
	const statusText = runFile('wpctl', ['status'], { env }) || '';
	if (!statusText) {
		return formatSpeakerReport(null, []);
	}
	const sinks = parseWpctlStatus(statusText);
	return formatSpeakerReport(pickSpeakerSink(sinks), sinks);
}

function probePipewire(env) {
	const pipewire = unitState('pipewire.service', { user: true, env });
	const pulse = unitState('pipewire-pulse.service', { user: true, env });
	return {
		pipewire,
		pulse,
		ready: pipewire === 'active' || processRunning('pipewire', env)
	};
}

function localServices(airplay, bluetooth, speakers, pipewire) {
	return [
		{
			name: 'AirPlay',
			status: airplay.ready,
			uptime: airplay.ready ? airplay.name : airplay.installed ? airplay.unit : 'not installed'
		},
		{
			name: 'nqptp',
			status: airplay.nqptp === 'active',
			uptime: airplay.nqptp
		},
		{
			name: 'Avahi',
			status: airplay.avahi === 'active',
			uptime: airplay.avahi
		},
		{
			name: 'Bluetooth',
			status: bluetooth.powered,
			uptime: bluetooth.powered ? bluetooth.name || 'on' : 'off'
		},
		{
			name: 'PipeWire',
			status: pipewire.ready,
			uptime: pipewire.pipewire
		},
		{
			name: speakers.pick ? `Speakers (${speakers.kind})` : 'Speakers',
			status: speakers.ok,
			uptime: speakers.pick?.name || 'none found'
		}
	];
}

export async function getKioskStatus() {
	const env = userSessionEnv();
	const [telemetry, nowPlaying] = await Promise.all([
		getTelemetry(),
		getNowPlaying({ skipLyrics: true })
	]);
	const airplay = probeAirplay(env);
	const bluetooth = probeBluetooth(env);
	const speakers = probeSpeakers(env);
	const pipewire = probePipewire(env);
	const git = getGitContext();
	const local = localServices(airplay, bluetooth, speakers, pipewire);
	const remote = Array.isArray(telemetry.services)
		? telemetry.services.filter((s) => !/^Speakers\b/i.test(s.name))
		: [];

	return {
		ts: Date.now(),
		host: os.hostname(),
		uptime: os.uptime(),
		panel: { hdmi: readHdmiStamp() },
		airplay,
		bluetooth,
		speakers,
		pipewire,
		nowPlaying,
		stats: telemetry.stats || {},
		services: [...local, ...remote],
		git: {
			branch: git.branch,
			sha: git.sha,
			dirty: git.dirty,
			message: git.message
		}
	};
}
