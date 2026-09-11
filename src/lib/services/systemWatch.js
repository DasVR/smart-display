import { pushIslandEvent } from '$lib/stores.js';

/**
 * Polls host telemetry independent of whichever view is mounted, so the
 * Dynamic Island can surface "docker broke" / "service down" events even
 * while looking at Weather or Music. DevHub polls the same endpoint for its
 * own detailed view; this runs in parallel purely for event detection.
 *
 * Only reacts to signals the API actually reports (service up/down,
 * container count). There's no build/lint/error feed anywhere in this app,
 * so "code errors" aren't detected here — surfacing something for that
 * without a real signal would be fabricating status, not reporting it.
 */

const POLL_MS = 6000;

let prevServices = null;
let prevContainers = null;
let timer = 0;
let destroyed = false;

function diffServices(services) {
	if (!Array.isArray(services)) return;
	const prevByName = new Map((prevServices || []).map((s) => [s.name, s.status]));
	for (const svc of services) {
		const was = prevByName.get(svc.name);
		if (was === true && svc.status === false) {
			pushIslandEvent({ title: 'Service down', body: svc.name, severity: 'error', ttl: 8000 });
		} else if (was === false && svc.status === true) {
			pushIslandEvent({ title: 'Service recovered', body: svc.name, severity: 'ok', ttl: 4000 });
		}
	}
	prevServices = services;
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
	poll();
	return () => {
		destroyed = true;
		clearTimeout(timer);
	};
}
