import { writable } from 'svelte/store';

export const currentView = writable('clock');
export const wsStatus = writable('connecting');
export const nowPlaying = writable(null);
export const weather = writable({ temp: '--', desc: '--', icon: '☁️' });
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
	changed: 0
});

export const viewNames = {
	clock: 'Clock',
	school: 'School',
	dev: 'Dev',
	music: 'Music'
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
