/**
 * The last good weather, kept on disk, so the wall's first frame after a
 * restart is complete instead of "--" filling in as the network wakes up.
 *
 *  - fresh (under FRESH_MS): answered from memory, no request
 *  - older, or none in memory: the last good copy from disk (up to KEEP_MS
 *    old) is answered at once, marked `stale`, while a refresh runs; the
 *    wall asks again shortly (src/routes/+page.svelte fetchWeather)
 *  - nothing at all: waits for the network, as before
 *
 * A failed fetch (no `fetchedAt`) never replaces a good copy.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const FRESH_MS = 60 * 1000;
export const KEEP_MS = 6 * 3600 * 1000;

export function createWeatherCache({ dataDir, load, now = () => Date.now(), log = console.log }) {
	const file = path.join(dataDir, 'weather-last.json');
	let last = null; // { at, data }
	let inflight = null;

	function fromDisk() {
		try {
			const saved = JSON.parse(readFileSync(file, 'utf8'));
			return saved?.data && Number.isFinite(saved.at) ? saved : null;
		} catch {
			return null;
		}
	}

	function save(entry) {
		try {
			mkdirSync(dataDir, { recursive: true });
			writeFileSync(`${file}.tmp`, JSON.stringify(entry));
			renameSync(`${file}.tmp`, file);
		} catch (e) {
			log(`weather cache: ${e.message}`);
		}
	}

	function refresh(hours) {
		if (!inflight) {
			inflight = Promise.resolve(load(hours))
				.then((data) => {
					if (data?.fetchedAt) {
						last = { at: now(), data };
						save(last);
					}
					return data;
				})
				.finally(() => {
					inflight = null;
				});
		}
		return inflight;
	}

	/** The weather to answer with now. */
	async function get(hours = 48) {
		if (last && now() - last.at < FRESH_MS) return last.data;
		if (!last) {
			// just started: answer with the copy from before, and fetch behind it
			const disk = fromDisk();
			if (disk && now() - disk.at < KEEP_MS) {
				last = disk;
				refresh(hours).catch(() => {});
				return { ...disk.data, stale: true };
			}
		}
		const data = await refresh(hours);
		// the network failed: a recent forecast beats "--"
		if (!data?.fetchedAt && last && now() - last.at < KEEP_MS) return { ...last.data, stale: true };
		return data;
	}

	return { get, refresh };
}
