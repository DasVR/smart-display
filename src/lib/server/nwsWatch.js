/**
 * Watches api.weather.gov for alerts at home, fast.
 *
 * The National Weather Service is the source for US watches and warnings: the
 * same alerts that drive phone emergency alerts, NOAA Weather Radio and the
 * TV crawl, on api.weather.gov within a minute or so of being issued. A point
 * query gives exactly the alerts for this address, including storm-based
 * warning polygons rather than whole counties.
 *
 * It asks every 30 seconds, every 15 while a watch or warning is up, with the
 * ETag so an unchanged answer is a tiny 304 (the API caches for 5 seconds,
 * so this is well within its manners). A failed check keeps the last good
 * list rather than pretending the sky cleared, and says it's stale after a
 * few minutes.
 *
 * subscribe(fn) (or onChange) gets (alerts, { added, removed }) when the set changes.
 * getWeather() reads alerts() too, so the Weather view and the wall agree.
 */
import { normalizeNws } from '../nwsAlerts.js';

const API = 'https://api.weather.gov/alerts/active';
const CALM_MS = 30_000;
const ALERT_MS = 15_000;
const STALE_MS = 5 * 60_000;
const TIMEOUT_MS = 8_000;

export function createNwsWatch({
	lat,
	lon,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	onChange = () => {},
	// the API asks every client to say who it is, with a way to reach them
	userAgent = process.env.NWS_USER_AGENT || '(smart-display wall, github.com/DasVR/smart-display)',
	log = console
} = {}) {
	const url = `${API}?point=${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}&status=actual`;
	let list = [];
	let etag = '';
	let lastRaw = null;
	let checkedAt = 0;
	let okAt = 0;
	let timer = null;
	let running = false;
	let inflight = null;
	const listeners = new Set([onChange]);

	function keyOf(alerts) {
		return alerts.map((a) => a.id).join('|');
	}

	async function check() {
		if (inflight) return inflight;
		inflight = (async () => {
			checkedAt = now();
			try {
				const res = await fetchImpl(url, {
					headers: { 'User-Agent': userAgent, Accept: 'application/geo+json', ...(etag ? { 'If-None-Match': etag } : {}) },
					signal: AbortSignal.timeout(TIMEOUT_MS)
				});
				if (res.status === 304 && lastRaw) {
					okAt = now();
					return apply(normalizeNws(lastRaw, now())); // same feed, but something may have just expired
				}
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				lastRaw = await res.json();
				etag = res.headers.get('etag') || '';
				okAt = now();
				return apply(normalizeNws(lastRaw, now()));
			} catch (err) {
				log.warn?.(`[nws] alerts check failed: ${err?.message || err}`);
				// keep the last good list; it still expires on its own clock
				return apply(list.filter((a) => !a.ends || Date.parse(a.ends) > now()));
			} finally {
				inflight = null;
			}
		})();
		return inflight;
	}

	function apply(next) {
		const before = new Set(list.map((a) => a.id));
		const after = new Set(next.map((a) => a.id));
		const added = next.filter((a) => !before.has(a.id));
		const removed = list.filter((a) => !after.has(a.id));
		const changed = keyOf(next) !== keyOf(list);
		list = next;
		if (changed) {
			for (const fn of listeners) {
				try {
					fn(list, { added, removed });
				} catch (err) {
					log.warn?.(`[nws] listener failed: ${err?.message || err}`);
				}
			}
		}
		return list;
	}

	/** Every 30 s, or 15 s while anything above an advisory is up. */
	function interval() {
		return list.some((a) => a.tier === 'warning' || a.tier === 'watch') ? ALERT_MS : CALM_MS;
	}

	function loop() {
		if (!running) return;
		timer = setTimeout(async () => {
			await check();
			loop();
		}, interval());
		timer.unref?.();
	}

	function start() {
		if (running) return;
		running = true;
		check().finally(loop);
	}

	function stop() {
		running = false;
		clearTimeout(timer);
	}

	/** The current alerts, and how fresh they are. */
	function status() {
		return { alerts: list, checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null, stale: !okAt || now() - okAt > STALE_MS };
	}

	function subscribe(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	return { start, stop, check, subscribe, alerts: () => list, status, running: () => running };
}

/**
 * Act-now warnings ring on the wall (src/lib/server/attentionHub.js): a new
 * one is raised, an update of one (NWS reissues under a new id that
 * references the old) carries on as the same item, ringing or answered, and
 * one that ends or is cancelled settles on its own.
 */
export function ringForWarnings(watch, attention) {
	return watch.subscribe((alerts, { added, removed }) => {
		const gone = new Map(removed.map((a) => [a.id, a]));
		for (const a of added) {
			if (a.tier !== 'warning') continue;
			const updates = a.references.find((id) => gone.has(id));
			if (updates) {
				gone.delete(updates);
				attention.rekey(`nws:${updates}`, `nws:${a.id}`, { title: a.event, body: a.headline });
				continue;
			}
			attention.raise({ kind: 'severe', title: a.event, body: a.headline, ref: `nws:${a.id}` });
		}
		for (const id of gone.keys()) attention.settle(`nws:${id}`);
	});
}
