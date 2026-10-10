/**
 * Pairing phones with the wall, the way an Apple TV pairs a remote: the wall
 * shows a six-digit code for two minutes, the phone types it, and gets a
 * device token it keeps. The token says which phone is talking, so the
 * household features know who "I" am. Once pairing is required, a phone
 * without one can't see or control anything over /ws.
 *
 *   data/devices.json   paired phones: id, name, a SHA-256 of the token,
 *                       when paired and last seen (never the token itself)
 *   data/pairing.json   { required: bool }
 *
 * Off by default: pairing only adds identity until someone turns
 * "require pairing" on from a paired phone. The kiosk's own browser is
 * always trusted (see isLocalAddress), and DISPLAY_REQUIRE_PAIRING=0 in the
 * service's environment turns the requirement off whatever the file says,
 * so a lost phone can never lock you out of your own wall.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CODE_TTL_MS = 2 * 60000;
const MAX_TRIES = 5;
// wrong guesses across all codes: starting fresh codes doesn't buy more tries
const MAX_MISSES = 10;
const MISS_WINDOW_MS = 10 * 60000;
const MAX_DEVICES = 24;
const SEEN_WRITE_MS = 10 * 60000;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

function sameText(a, b) {
	const x = Buffer.from(String(a));
	const y = Buffer.from(String(b));
	return x.length === y.length && timingSafeEqual(x, y);
}

function readJson(file, fallback) {
	try {
		return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
	} catch {
		return fallback;
	}
}

/** A name a person typed for their phone, made safe to show. */
export function cleanDeviceName(name) {
	const s = String(name ?? '')
		.replace(/<[^>]*>/g, '')
		.replace(/[\u0000-\u001f<>]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 32);
	return s || 'Phone';
}

/** The kiosk's own browser: loopback, or one of this machine's own addresses
 *  (when the kiosk opens the page by its LAN or Tailscale address). */
export function isLocalAddress(addr, ownAddresses = []) {
	const a = String(addr || '').replace(/^::ffff:/, '');
	if (!a) return false;
	if (a === '::1' || a.startsWith('127.')) return true;
	return ownAddresses.some((own) => String(own).replace(/^::ffff:/, '') === a);
}

export function createPairing({ dataDir, now = () => Date.now(), env = process.env }) {
	const devicesFile = path.join(dataDir, 'devices.json');
	const settingsFile = path.join(dataDir, 'pairing.json');
	let devices = readJson(devicesFile, []);
	if (!Array.isArray(devices)) devices = [];
	let settings = readJson(settingsFile, { required: false });
	let pending = null; // { code, expiresAt, tries }
	let lastSeenWrite = 0;
	let misses = []; // times of recent wrong guesses

	function save() {
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(devicesFile, JSON.stringify(devices, null, 2), { mode: 0o600 });
	}

	const view = (d) => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen });

	function required() {
		if (String(env.DISPLAY_REQUIRE_PAIRING ?? '') === '0') return false;
		// requiring pairing with nobody paired would only lock everyone out
		return Boolean(settings.required) && devices.length > 0;
	}

	function setRequired(on) {
		settings = { ...settings, required: Boolean(on) };
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
		return status();
	}

	function status() {
		return {
			required: required(),
			requiredSetting: Boolean(settings.required),
			overriddenByEnv: String(env.DISPLAY_REQUIRE_PAIRING ?? '') === '0',
			devices: devices.map(view),
			codeActive: Boolean(pending && pending.expiresAt > now())
		};
	}

	/** A new code for the wall to show; replaces any earlier one. */
	function startCode() {
		const code = String(randomInt(0, 1000000)).padStart(6, '0');
		pending = { code, expiresAt: now() + CODE_TTL_MS, tries: 0 };
		return { code, expiresAt: pending.expiresAt };
	}

	function cancelCode() {
		pending = null;
	}

	/** Trade the code on the wall for a device token. */
	function redeem(code, name) {
		if (!pending || pending.expiresAt <= now()) {
			pending = null;
			return { error: 'expired' };
		}
		misses = misses.filter((t) => now() - t < MISS_WINDOW_MS);
		if (misses.length >= MAX_MISSES) {
			pending = null;
			return { error: 'too-many-tries' };
		}
		const typed = String(code ?? '').replace(/\D/g, '');
		if (!sameText(typed, pending.code)) {
			misses.push(now());
			pending.tries++;
			if (pending.tries >= MAX_TRIES) pending = null;
			return { error: pending ? 'wrong-code' : 'too-many-tries' };
		}
		pending = null;
		if (devices.length >= MAX_DEVICES) return { error: 'too-many-devices' };
		const token = randomBytes(32).toString('base64url');
		const device = {
			id: randomBytes(6).toString('hex'),
			name: cleanDeviceName(name),
			hash: sha(token),
			pairedAt: new Date(now()).toISOString(),
			lastSeen: new Date(now()).toISOString()
		};
		devices.push(device);
		save();
		return { token, device: view(device) };
	}

	/** The paired device a token belongs to, or null. */
	function verify(token) {
		if (!token || typeof token !== 'string' || token.length > 128) return null;
		const h = sha(token);
		const d = devices.find((x) => sameText(x.hash, h));
		if (!d) return null;
		d.lastSeen = new Date(now()).toISOString();
		if (now() - lastSeenWrite > SEEN_WRITE_MS) {
			lastSeenWrite = now();
			save();
		}
		return view(d);
	}

	function rename(id, name) {
		const d = devices.find((x) => x.id === id);
		if (!d) return null;
		d.name = cleanDeviceName(name);
		save();
		return view(d);
	}

	function revoke(id) {
		const before = devices.length;
		devices = devices.filter((d) => d.id !== id);
		if (devices.length === before) return false;
		save();
		return true;
	}

	return { status, required, setRequired, startCode, cancelCode, redeem, verify, rename, revoke };
}
