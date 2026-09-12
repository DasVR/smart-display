import { pushIslandEvent, setIslandActivity, clearIslandActivity } from '$lib/stores.js';
import { applyServiceSnapshot } from '$lib/islandLive.js';

/**
 * Polls host telemetry independent of whichever view is mounted, so the
 * Dynamic Island can surface "docker broke" / "service down" events even
 * while looking at Weather or Music. DevHub polls the same endpoint for its
 * own detailed view; this runs in parallel purely for event detection.
 *
 * Downed services also stay as compact Live Activities until they recover,
 * matching iPhone's persistent island statuses. Only reacts to signals the
 * API actually reports (service up/down, container count).
 */

const POLL_MS = 6000;

let prevServices = null;
let prevContainers = null;
let timer = 0;
let destroyed = false;

function diffServices(services) {
	const snap = applyServiceSnapshot(prevServices, services);
	prevServices = snap.prev;
	for (const ev of snap.events) pushIslandEvent(ev);
	for (const activity of snap.set) setIslandActivity(activity.id, activity);
	for (const id of snap.clear) clearIslandActivity(id);
}

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
			diffServices(data?.services);
			diffContainers(data?.stats?.containers);
		}
	} catch {
		/* transient fetch failures aren't themselves an event; the wsStatus
		   store already reports connectivity loss */
	}
	if (!destroyed) timer = setTimeout(poll, POLL_MS);
}

/** Call once (e.g. from the root layout's onMount). Returns a cleanup function. */
export function startSystemWatch() {
	destroyed = false;
	prevServices = null;
	prevContainers = null;
	poll();
	return () => {
		destroyed = true;
		clearTimeout(timer);
	};
}
