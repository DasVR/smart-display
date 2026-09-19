import { readFileSync } from 'node:fs';
import os from 'node:os';

/** Instant CPU/RAM. Telemetry used 1-minute loadavg, which is too slow to
 *  yield the GPU while a compile or model is actually running. */

export function parseProcStat(text = '') {
	const line = String(text)
		.split('\n')
		.find((row) => row.startsWith('cpu '));
	if (!line) return null;
	const parts = line.trim().split(/\s+/).slice(1).map(Number);
	if (parts.length < 4) return null;
	const idle = (parts[3] || 0) + (parts[4] || 0);
	const total = parts.slice(0, 8).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
	if (!(total > 0)) return null;
	return { idle, total };
}

export function cpuPercentFromDelta(prev, next) {
	if (!prev || !next) return null;
	const total = next.total - prev.total;
	if (!(total > 0)) return null;
	const idle = next.idle - prev.idle;
	const busy = total - idle;
	return Math.min(100, Math.max(0, (busy / total) * 100));
}

export function ramStats(totalBytes, freeBytes) {
	const total = Number(totalBytes) || 0;
	const free = Number(freeBytes) || 0;
	const used = Math.max(0, total - free);
	const ramPct = total > 0 ? (used / total) * 100 : 0;
	const gb = (n) => Math.round((n / 1024 / 1024 / 1024) * 10) / 10;
	return {
		ram_used: gb(used),
		ram_total: gb(total),
		ramPct
	};
}

function readProcStat() {
	try {
		return readFileSync('/proc/stat', 'utf8');
	} catch {
		return '';
	}
}

export function createHostLoadSampler({
	readStat = readProcStat,
	totalmem = () => os.totalmem(),
	freemem = () => os.freemem()
} = {}) {
	let prev = null;
	return function sample() {
		const snap = parseProcStat(readStat());
		const cpu = cpuPercentFromDelta(prev, snap);
		if (snap) prev = snap;
		const ram = ramStats(totalmem(), freemem());
		const load = os.loadavg()[0];
		const cpus = os.cpus()?.length || 1;
		return {
			cpu: cpu == null ? Math.min(100, Math.round((load / cpus) * 100)) : Math.round(cpu),
			cpuReady: cpu != null,
			load,
			cpus,
			...ram
		};
	};
}

const defaultSampler = createHostLoadSampler();

export function getHostLoad() {
	return defaultSampler();
}
