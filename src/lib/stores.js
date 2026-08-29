import { writable } from 'svelte/store';

export const currentView = writable('clock');
export const wsStatus = writable('connecting');
export const nowPlaying = writable(null);
export const weather = writable({ temp: '--', desc: '--', icon: '☁️' });
export const goveeState = writable({ on: false, mode: 'idle', color: [0,0,0] });
export const upcomingEvents = writable([]);
export const recentCommits = writable([]);

export const viewNames = {
	clock: 'Clock',
	school: 'School',
	dev: 'Dev',
	music: 'Music'
};
