import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Minimal "is any Bluetooth device connected right now" probe.
 *
 * Kept deliberately separate from kioskStatus.js (which already imports
 * getNowPlaying from hostData.js) so hostData.js can check connection state
 * without creating a circular import. Cached briefly so now-playing polling
 * (every ~1s from the client) doesn't spawn bluetoothctl on every tick.
 * Async (not execFileSync) so it doesn't block the event loop - see
 * kioskStatus.js for the fuller note on why that matters here. */

const CACHE_MS = 800;
const CONNECTED_DEVICE_RE = /^Device\s+[0-9A-Fa-f:]{17}/m;
const cache = { at: 0, connected: false };

function sessionEnv() {
	const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
	const dir = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
	const env = { ...process.env, XDG_RUNTIME_DIR: dir };
	const busPath = path.join(dir, 'bus');
	if (existsSync(busPath)) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`;
	return env;
}

export function parseAnyBluetoothConnected(text = '') {
	return CONNECTED_DEVICE_RE.test(String(text || ''));
}

export async function isBluetoothDeviceConnected({ force = false, now = Date.now(), run } = {}) {
	if (!force && now - cache.at < CACHE_MS) return cache.connected;
	let connected = cache.connected;
	try {
		const exec =
			run ||
			(async (args, env) => {
				const { stdout } = await execFileAsync('bluetoothctl', args, {
					encoding: 'utf8',
					timeout: 2000,
					env
				});
				return stdout;
			});
		const out = await exec(['--timeout', '3', 'devices', 'Connected'], sessionEnv());
		connected = parseAnyBluetoothConnected(out);
	} catch {
		connected = false;
	}
	cache.at = now;
	cache.connected = connected;
	return connected;
}

export function resetBluetoothConnectionCache() {
	cache.at = 0;
	cache.connected = false;
}
