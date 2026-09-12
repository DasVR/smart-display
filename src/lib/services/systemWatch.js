import { setIslandActivity, clearIslandActivity } from '$lib/stores.js';
import { applyServiceSnapshot } from '$lib/islandLive.js';
import { playChime } from '$lib/services/chime.js';

/**
 * Polls host telemetry independent of whichever view is mounted, so the
 * bottom status dock can show "service down" even while looking at Weather
 * or Music. DevHub polls the same endpoint for its own detailed view; this
 * runs in parallel purely for event detection.
 *
 * Downed services stay as trough chips until they recover. They do not
 * expand the Dynamic Island (that covered the date and tabs). Only reacts
 * to signals the API actually reports (service up/down, container count).
 */

const POLL_MS = 6000;

let prevServices = null;
let prevContainers = null;
let timer = 0;
let destroyed = false;
const ttlTimers = new Map();

function armTtl(activity) {
	if (!activity?.ttl || !activity.id) return;
	const prev = ttlTimers.get(activity.id);
	if (prev) clearTimeout(prev);
	ttlTimers.set(
		activity.id,
		setTimeout(() => {
			clearIslandActivity(activity.id);
			ttlTimers.delete(activity.id);
		}, activity.ttl)
	);
}

function diffServices(services) {
	const snap = applyServiceSnapshot(prevServices, services);
	prevServices = snap.prev;
	for (const id of snap.clear) clearIslandActivity(id);
	for (const activity of snap.set) {
		setIslandActivity(activity.id, activity);
		armTtl(activity);
	}
	if (!snap.seed) {
		for (const ev of snap.events) playChime(ev.severity);
	}
}

function diffContainers(containers) {
	if (typeof containers !== 'number' || Number.isNaN(containers)) return;
	if (prevContainers !== null && containers < prevContainers) {
		const dropped = prevContainers - containers;
		const activity = {
			id: 'containers',
			kind: 'containers',
			title: 'Containers',
			body: `${dropped} exited`,
			severity: 'warn',
			ttl: 8000
		};
		setIslandActivity(activity.id, activity);
		armTtl(activity);
		playChime('warn');
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
		for (const t of ttlTimers.values()) clearTimeout(t);
		ttlTimers.clear();
	};
}
