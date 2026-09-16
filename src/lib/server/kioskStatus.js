import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { formatSpeakerReport, parseWpctlStatus, pickSpeakerSink } from './audioSinks.js';
import { readHdmiStamp } from './displayPower.js';
import { getGitContext, getNowPlaying, getTelemetry } from './hostData.js';
import { getHostUpdates } from './hostUpdates.js';
import { getInstallProgress } from './hostUpgrade.js';

const execFileAsync = promisify(execFile);

const AIRPLAY_UNITS = {
	unit: 'smart-display-airplay.service',
	meta: 'smart-display-airplay-meta.service'
};

// Every probe in this module used to shell out synchronously (execSync/
// execFileSync), which blocks Node's single event loop thread for however
// long the subprocess takes - while getKioskStatus is blocked mid-probe,
// nothing else on the server (a remote's WebSocket ping, a volume request,
// any other HTTP request) gets processed either. That's the "the remote
// lags" bug: not the network, the server locking itself up on its own
// system probes every few seconds. execFile (async) lets the event loop
// keep serving other requests while a subprocess runs, and independent
// probes below run concurrently via Promise.all instead of queueing.
async function run(cmd, timeout = 3000) {
	try {
		const { stdout } = await execFileAsync('/bin/sh', ['-c', cmd], { encoding: 'utf8', timeout });
		return stdout.trim();
	} catch (error) {
		const out = String(error?.stdout || '').trim();
		return out || null;
	}
}

async function runFile(bin, args, opts = {}) {
	const timeout = opts.timeout ?? 3000;
	try {
		const { stdout } = await execFileAsync(bin, args, {
			encoding: 'utf8',
			timeout,
			...(opts.env ? { env: opts.env } : {})
		});
		return stdout.trim();
	} catch (error) {
		const out = String(error?.stdout || '').trim();
		return out || null;
	}
}

async function which(bin, env) {
	const extra = env?.PATH ? `PATH=${JSON.stringify(env.PATH)} ` : '';
	return run(`${extra}command -v ${bin} 2>/dev/null`);
}

export const SHAIRPORT_BINARIES = ['/usr/local/bin/shairport-sync', '/usr/bin/shairport-sync'];

export async function findShairportBinary({ exists = existsSync, lookup = which } = {}) {
	for (const candidate of SHAIRPORT_BINARIES) {
		if (exists(candidate)) return candidate;
	}
	return (await lookup('shairport-sync')) || '';
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

export function parseBluetoothInfo(text = '') {
	const raw = String(text || '');
	const rssi = (raw.match(/^\s*RSSI:\s*(-?\d+)/m) || [])[1];
	const txPower = (raw.match(/^\s*TxPower:\s*(-?\d+)/m) || [])[1];
	return {
		rssi: rssi === undefined ? null : Number(rssi),
		txPower: txPower === undefined ? null : Number(txPower)
	};
}

// Log-distance path loss model. txPower is the RSSI expected at 1 meter
// (BLE beacons commonly calibrate to about -59 dBm); n=2 approximates
// open-air/line-of-sight attenuation, higher values suit walls/clutter.
export function estimateDistanceMeters(rssi, { txPower = -59, n = 2 } = {}) {
	if (typeof rssi !== 'number' || Number.isNaN(rssi)) return null;
	const ref = typeof txPower === 'number' && !Number.isNaN(txPower) ? txPower : -59;
	return Number(Math.pow(10, (ref - rssi) / (10 * n)).toFixed(1));
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

async function unitState(unit, { user = false, env } = {}) {
	const args = user ? ['--user', 'is-active', unit] : ['is-active', unit];
	let state = parseSystemctlActive(await runFile('systemctl', args, { env: user ? env : undefined }));
	if (user && state === 'unknown') {
		const machine = `${os.userInfo().username}@`;
		state = parseSystemctlActive(
			await runFile('systemctl', ['--user', `--machine=${machine}`, 'is-active', unit])
		);
	}
	return state;
}

async function processRunning(name, env) {
	return Boolean((await runFile('pidof', [name], { env })) || (await runFile('pgrep', ['-x', name], { env })));
}

async function probeAirplay(env) {
	const [binary, unit, meta, nqptp, avahi] = await Promise.all([
		findShairportBinary({ lookup: (bin) => which(bin, env) }),
		unitState(AIRPLAY_UNITS.unit, { user: true, env }),
		unitState(AIRPLAY_UNITS.meta, { user: true, env }),
		unitState('nqptp.service'),
		unitState('avahi-daemon.service')
	]);
	const versionText = binary ? (await runFile(binary, ['-V'], { env })) || '' : '';
	const confPath =
		process.env.SHAIRPORT_CONF || path.join(os.homedir(), '.config/shairport-sync.conf');
	let resolvedUnit = unit;
	if (resolvedUnit === 'unknown' && (await processRunning('shairport-sync', env))) {
		resolvedUnit = 'active';
	}
	return buildAirplayStatus({
		binary,
		versionText,
		confText: readText(confPath),
		unit: resolvedUnit,
		meta,
		nqptp,
		avahi
	});
}

async function probeDistance(address, env) {
	const info = (await runFile('bluetoothctl', ['info', address], { env, timeout: 2000 })) || '';
	const { rssi, txPower } = parseBluetoothInfo(info);
	return { rssi, distanceMeters: estimateDistanceMeters(rssi, { txPower }) };
}

/** Connected-device RSSI/distance only, without the rest of getKioskStatus's
 *  probes (AirPlay, speakers, telemetry, git...) - cheap enough to poll on
 *  its own cadence for proximity wake. */
export async function getBluetoothProximity() {
	const env = userSessionEnv();
	return (await probeBluetooth(env)).connected;
}

async function probeBluetooth(env) {
	const [show, connectedText, agent, watch] = await Promise.all([
		runFile('bluetoothctl', ['--timeout', '3', 'show'], { env }),
		runFile('bluetoothctl', ['--timeout', '3', 'devices', 'Connected'], { env }),
		unitState('smart-display-bt-agent.service'),
		unitState('smart-display-bt-watch.service')
	]);
	const adapter = parseBluetoothShow(show || '');
	const devices = parseBluetoothDevices(connectedText || '');
	const connected = await Promise.all(
		devices.map(async (device) => ({ ...device, ...(await probeDistance(device.address, env)) }))
	);
	return {
		...adapter,
		connected,
		agent,
		watch,
		ready: adapter.powered && agent === 'active'
	};
}

async function probeSpeakers(env) {
	const statusText = (await runFile('wpctl', ['status'], { env })) || '';
	if (!statusText) {
		return formatSpeakerReport(null, []);
	}
	const sinks = parseWpctlStatus(statusText);
	return formatSpeakerReport(pickSpeakerSink(sinks), sinks);
}

async function probePipewire(env) {
	const [pipewire, pulse] = await Promise.all([
		unitState('pipewire.service', { user: true, env }),
		unitState('pipewire-pulse.service', { user: true, env })
	]);
	const ready = pipewire === 'active' || (await processRunning('pipewire', env));
	return { pipewire, pulse, ready };
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
	const [telemetry, nowPlaying, airplay, bluetooth, speakers, pipewire, git, updates] = await Promise.all([
		getTelemetry(),
		getNowPlaying({ skipLyrics: true }),
		probeAirplay(env),
		probeBluetooth(env),
		probeSpeakers(env),
		probePipewire(env),
		getGitContext(),
		getHostUpdates()
	]);
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
			message: git.message,
			ahead: git.ahead || 0,
			behind: git.behind || 0
		},
		updates,
		installProgress: getInstallProgress()
	};
}
