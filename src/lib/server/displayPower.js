import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PROJECT_ROOT =
	process.env.SMART_DISPLAY_ROOT ||
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function scriptPath(name) {
	return path.join(PROJECT_ROOT, 'scripts', name);
}

export function stampPath() {
	if (process.env.DISPLAY_HDMI_STAMP) return process.env.DISPLAY_HDMI_STAMP;
	const runtimeDir = process.env.XDG_RUNTIME_DIR || '/run/user/1000';
	if (existsSync(runtimeDir)) return path.join(runtimeDir, 'smart-display-hdmi');
	return path.join(os.tmpdir(), 'smart-display-hdmi');
}

export function readHdmiStamp(file = stampPath()) {
	try {
		if (!existsSync(file)) return 'unknown';
		const value = readFileSync(file, 'utf8').trim();
		return value === 'on' || value === 'off' ? value : 'unknown';
	} catch {
		return 'unknown';
	}
}

export function writeHdmiStamp(state, file = stampPath()) {
	try {
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, state === 'on' ? 'on' : 'off');
	} catch (error) {
		console.error('hdmi stamp failed', error.message);
	}
	return file;
}

export async function setPanelPower(on, opts = {}) {
	const state = on ? 'on' : 'off';
	const stamp = opts.stampPath ?? stampPath();
	writeHdmiStamp(state, stamp);
	const script = opts.script ?? scriptPath(on ? 'display-on.sh' : 'display-off.sh');
	const run = opts.execFile ?? execFileAsync;
	try {
		await run(script, { timeout: 8000 });
	} catch (error) {
		console.error(`hdmi ${state} failed`, error.message);
	}
	return state;
}
