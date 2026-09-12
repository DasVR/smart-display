import { writable } from 'svelte/store';

export const currentView = writable('clock');
export const displayMode = writable('normal'); // normal | sleep | morning
export const wsStatus = writable('connecting');
export const nowPlaying = writable(null);
export const weather = writable({ temp: '--', desc: '--' });
export const weatherDetail = writable(null);
export const rainPrediction = writable({ rain30min: 0, rain60min: 0, rain120min: 0, source: 'rule' });
export const goveeState = writable({ on: false, mode: 'idle', color: [0, 0, 0] });
export const upcomingEvents = writable([]);
export const recentCommits = writable([]);
export const telemetry = writable({
	services: [],
	stats: { cpu: 0, ram_used: 0, ram_total: 0, containers: 0, net_mbps: 0 }
});
export const telemetryHistory = writable({
	cpu: [],
	ram: [],
	net: []
});
export const gitContext = writable({
	branch: '--',
	message: '',
	sha: '',
	dirty: false,
	changed: 0,
	files: [],
	commitFiles: []
});

export const islandQueue = writable([]);
export const islandActivities = writable([]);

let islandEventSeq = 0;

/** Queues a transient system event for the Dynamic Island to surface. FIFO; each
 *  auto-dismisses after `ttl` ms unless replaced sooner by the queue itself.
 *  `source` names who raised it (Claude Code, Cursor, Hermes, etc.) and is
 *  shown in place of the generic severity label when present. The island
 *  itself plays a chime per distinct event it actually shows — not here —
 *  so a queued event that never surfaces (superseded before its turn) never
 *  makes a sound for something the user never saw. */
export function pushIslandEvent({ title, body = '', severity = 'info', ttl = 9000, source = '', kind = 'notice' }) {
	const id = ++islandEventSeq;
	islandQueue.update((q) => [...q, { id, title, body, severity, source, kind }]);
	setTimeout(() => {
		islandQueue.update((q) => q.filter((e) => e.id !== id));
	}, ttl);
	return id;
}

/** Persistent compact island status (iPhone Live Activity). `id` is stable so
 *  a service that stays down does not stack duplicates every poll. */
export function setIslandActivity(id, payload) {
	const item = { ...payload, id };
	islandActivities.update((list) => {
		const idx = list.findIndex((a) => a.id === id);
		if (idx === -1) return [...list, item];
		if (
			list[idx].kind === item.kind &&
			list[idx].title === item.title &&
			list[idx].body === item.body &&
			list[idx].severity === item.severity
		) {
			return list;
		}
		const next = list.slice();
		next[idx] = item;
		return next;
	});
}

export function clearIslandActivity(id) {
	islandActivities.update((list) => list.filter((a) => a.id !== id));
}

export const viewNames = {
	clock: 'Clock',
	school: 'School',
	dev: 'Dev',
	music: 'Music',
	weather: 'Weather'
};

const HISTORY_LEN = 40;

export function pushTelemetrySample(sample) {
	telemetry.set(sample);
	telemetryHistory.update((hist) => {
		const ramPct = sample?.stats?.ram_total
			? (sample.stats.ram_used / sample.stats.ram_total) * 100
			: 0;
		const next = {
			cpu: [...hist.cpu, Number(sample?.stats?.cpu || 0)].slice(-HISTORY_LEN),
			ram: [...hist.ram, ramPct].slice(-HISTORY_LEN),
			net: [...hist.net, Number(sample?.stats?.net_mbps || 0)].slice(-HISTORY_LEN)
		};
		return next;
	});
}
