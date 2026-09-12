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

function runFile(bin, args, timeout = 3000) {
	try {
		return execFileSync(bin, args, {
			encoding: 'utf8',
			timeout,
			stdio: ['ignore', 'pipe', 'pipe']
		}).trim();
	} catch (error) {
		const out = String(error.stdout || '').trim();
		return out || null;
	}
}

function which(bin) {
	return run(`command -v ${bin} 2>/dev/null`);
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
	if (unit !== 'active') return 'AirPlay unit is stopped';
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

function unitState(unit, { user = false } = {}) {
	const args = ['is-active', unit];
	if (user) args.unshift('--user');
	return parseSystemctlActive(runFile('systemctl', args));
}

function probeAirplay() {
	const binary = which('shairport-sync');
	const versionText = binary ? runFile(binary, ['-V']) || '' : '';
	const confPath =
		process.env.SHAIRPORT_CONF || path.join(os.homedir(), '.config/shairport-sync.conf');
	return buildAirplayStatus({
		binary,
		versionText,
		confText: readText(confPath),
		unit: unitState(AIRPLAY_UNITS.unit, { user: true }),
		meta: unitState(AIRPLAY_UNITS.meta, { user: true }),
		nqptp: unitState('nqptp.service'),
		avahi: unitState('avahi-daemon.service')
	});
}

function probeBluetooth() {
	const show = runFile('bluetoothctl', ['--timeout', '3', 'show']) || '';
	const connectedText =
		runFile('bluetoothctl', ['--timeout', '3', 'devices', 'Connected']) || '';
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

function probeSpeakers() {
	const statusText = runFile('wpctl', ['status']) || '';
	if (!statusText) {
		return formatSpeakerReport(null, []);
	}
	const sinks = parseWpctlStatus(statusText);
	return formatSpeakerReport(pickSpeakerSink(sinks), sinks);
}

function probePipewire() {
	const pipewire = unitState('pipewire.service', { user: true });
	const pulse = unitState('pipewire-pulse.service', { user: true });
	return {
		pipewire,
		pulse,
		ready: pipewire === 'active'
	};
}

function localServices(airplay, bluetooth, speakers, pipewire) {
	return [
		{
			name: 'AirPlay',
			status: airplay.ready,
			uptime: airplay.ready ? airplay.name : airplay.hint
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
	const [telemetry, nowPlaying] = await Promise.all([
		getTelemetry(),
		getNowPlaying({ skipLyrics: true })
	]);
	const airplay = probeAirplay();
	const bluetooth = probeBluetooth();
	const speakers = probeSpeakers();
	const pipewire = probePipewire();
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
