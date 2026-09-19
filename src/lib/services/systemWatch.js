import { get } from 'svelte/store';
import { pushIslandEvent, setIslandActivity, clearIslandActivity, installProgress, pushTelemetrySample } from '$lib/stores.js';
import { islandActivityForUpdates } from '$lib/hostUpdatesModel.js';

/**
 * Polls host telemetry independent of whichever view is mounted, so the
 * Dynamic Island can surface "docker broke" events even while looking at
 * Weather or Music. The Agents host peek reads the same endpoint while
 * that view is up.
 */

const POLL_MS = 6000;
const UPDATES_POLL_MS = 15000;

let prevContainers = null;
let timer = 0;
let updatesTimer = 0;
let destroyed = false;

function diffContainers(containers) {
	if (typeof containers !== 'number' || Number.isNaN(containers)) return;
	if (prevContainers !== null && containers < prevContainers) {
		const dropped = prevContainers - containers;
		pushIslandEvent({
			title: 'Containers stopped',
			body: `${dropped} container${dropped === 1 ? '' : 's'} exited`,
			severity: 'warn',
			ttl: 8000
		});
	}
	prevContainers = containers;
}

async function poll() {
	if (destroyed) return;
	try {
		const r = await fetch('/api/telemetry');
		if (r.ok) {
			const data = await r.json();
			pushTelemetrySample(data);
			diffContainers(data?.stats?.containers);
		}
	} catch {
		/* transient fetch failures aren't themselves an event; the wsStatus
		   store already reports connectivity loss */
	}
	if (!destroyed) timer = setTimeout(poll, POLL_MS);
}

async function pollUpdates() {
	if (destroyed) return;
	try {
		if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('island') === 'install') {
			/* preview walkthrough owns the slot */
		} else {
			const r = await fetch('/api/updates');
			if (r.ok) {
				const data = await r.json();
				if (data.progress) installProgress.set(data.progress);
				const activity = islandActivityForUpdates(data);
				if (activity) setIslandActivity('update', activity);
				else clearIslandActivity('update');
			}
		}
	} catch {
		/* updates endpoint is optional in dev */
	}
	const delay = get(installProgress)?.active ? 450 : UPDATES_POLL_MS;
	if (!destroyed) updatesTimer = setTimeout(pollUpdates, delay);
}

/** Call once (e.g. from the root layout's onMount). Returns a cleanup function. */
export function startSystemWatch() {
	destroyed = false;
	prevContainers = null;
	poll();
	pollUpdates();
	return () => {
		destroyed = true;
		clearTimeout(timer);
		clearTimeout(updatesTimer);
	};
}
