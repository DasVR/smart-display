import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FRESH_MS, KEEP_MS, createWeatherCache } from '../src/lib/server/weatherCache.js';

const good = (temp) => ({ current: { temp }, fetchedAt: '2026-10-15T12:00:00Z' });
const failed = { current: { temp: '--' } };

function setup({ disk, loads }) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'wx-'));
	if (disk) writeFileSync(path.join(dataDir, 'weather-last.json'), JSON.stringify(disk));
	let t = 1_000_000_000;
	let calls = 0;
	const cache = createWeatherCache({
		dataDir,
		load: async () => loads[Math.min(calls++, loads.length - 1)],
		now: () => t,
		log() {}
	});
	return { cache, dataDir, advance: (ms) => (t += ms), at: () => t, calls: () => calls };
}

test('just restarted: the copy from before answers at once, marked stale, while fresh weather loads', async () => {
	const s = setup({ disk: { at: 1_000_000_000 - 3600_000, data: good(61) }, loads: [good(64)] });
	const first = await s.cache.get();
	assert.equal(first.current.temp, 61);
	assert.equal(first.stale, true);
	await new Promise((r) => setImmediate(r));
	const next = await s.cache.get();
	assert.equal(next.current.temp, 64);
	assert.equal(next.stale, undefined);
	assert.equal(s.calls(), 1, 'one fetch, not one per ask');
});

test('fresh weather is answered from memory; older is fetched and waited for', async () => {
	const s = setup({ loads: [good(60), good(62)] });
	assert.equal((await s.cache.get()).current.temp, 60);
	s.advance(FRESH_MS - 1);
	assert.equal((await s.cache.get()).current.temp, 60);
	assert.equal(s.calls(), 1);
	s.advance(2);
	const later = await s.cache.get();
	assert.equal(later.current.temp, 62);
	assert.equal(later.stale, undefined, 'in normal running the poll waits for the real thing');
});

test('a failed fetch never replaces a good copy, and an old one is too old to show', async () => {
	const s = setup({ loads: [good(60), failed] });
	await s.cache.get();
	s.advance(FRESH_MS + 1);
	const r = await s.cache.get();
	assert.equal(r.current.temp, 60);
	assert.equal(r.stale, true);
	const old = setup({ disk: { at: 1_000_000_000 - KEEP_MS, data: good(50) }, loads: [failed] });
	assert.equal((await old.cache.get()).current.temp, '--');
});
