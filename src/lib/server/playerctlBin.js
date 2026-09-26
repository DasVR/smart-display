import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { classifyPlayerctlFailure } from '../mprisPlayers.js';

const execFileAsync = promisify(execFile);

/** Systemd starts the dashboard with a short PATH. playerctl from apt, a
 *  local prefix, or snap still counts. */
export const PLAYERCTL_CANDIDATES = ['/usr/bin/playerctl', '/usr/local/bin/playerctl', '/snap/bin/playerctl'];

let cached = undefined;

export function resetPlayerctlBinCache() {
	cached = undefined;
}

export function pickPlayerctlBin(found) {
	for (const entry of found || []) {
		const path = String(entry || '').trim();
		if (path) return path;
	}
	return '';
}

async function lookupOnPath() {
	try {
		const { stdout } = await execFileAsync('/bin/sh', ['-c', 'command -v playerctl'], {
			encoding: 'utf8',
			timeout: 2000
		});
		const found = String(stdout || '')
			.trim()
			.split('\n')[0];
		if (found && found.includes('/') && existsSync(found)) return found;
	} catch {
		/* command -v exits 1 when the tool is absent */
	}
	return '';
}

export async function resolvePlayerctlBin() {
	if (cached !== undefined) return cached;
	const explicit = String(process.env.PLAYERCTL || '').trim();
	const present = [];
	if (explicit && existsSync(explicit)) present.push(explicit);
	for (const candidate of PLAYERCTL_CANDIDATES) {
		if (existsSync(candidate)) present.push(candidate);
	}
	const onPath = await lookupOnPath();
	if (onPath) present.push(onPath);
	cached = pickPlayerctlBin(present);
	return cached;
}

export async function runPlayerctl(args, { timeout = 3000 } = {}) {
	const bin = await resolvePlayerctlBin();
	if (!bin) {
		const error = Object.assign(new Error('spawn playerctl ENOENT'), { code: 'ENOENT', stderr: '' });
		return { ok: false, stdout: '', stderr: '', error, errorText: error.message };
	}
	try {
		const { stdout, stderr } = await execFileAsync(bin, args, { encoding: 'utf8', timeout });
		return { ok: true, stdout: stdout || '', stderr: stderr || '', error: null, errorText: '' };
	} catch (error) {
		const stderr = String(error?.stderr || '');
		if (classifyPlayerctlFailure(error) === 'missing') resetPlayerctlBinCache();
		return {
			ok: false,
			stdout: String(error?.stdout || ''),
			stderr,
			error,
			errorText: stderr.trim() || error?.message || 'playerctl failed'
		};
	}
}
