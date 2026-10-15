import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootRecord, bootStages, describeBoot, seconds } from '../src/lib/bootTimeline.js';
import { createBootLog } from '../src/lib/server/bootLog.js';
import { bootMarksFrom } from '../src/lib/wake.js';

const T = 1_792_000_000_000;

test('a boot, stage by stage, in the order things happened, with the slowest step named', () => {
	const rec = bootRecord({ power: T, server: T + 9000, listening: T + 10500, kiosk: T + 8000, reached: T + 10600, page: T + 10700, awake: T + 12200, junk: 5, page2: 'x' });
	assert.equal(rec.kind, 'boot');
	assert.deepEqual(bootStages(rec).map((s) => [s.key, s.at]), [
		['power', 0],
		['kiosk', 8000],
		['server', 9000],
		['listening', 10500],
		['reached', 10600],
		['page', 10700],
		['awake', 12200]
	]);
	const lines = describeBoot(rec);
	assert.match(lines[1], /8\.0 s\s+Browser shows the boot screen\s+← slowest step \(8\.0 s\)/);
	assert.equal(lines.at(-1), 'Total: 12.2 s (from power on)');
	assert.equal(bootRecord({ page: T, awake: T + 900 }).kind, 'reload');
	assert.deepEqual(describeBoot({}), ['No marks.']);
	assert.equal(seconds(850), '850 ms');
});

test('the boot page’s marks come through the address, and nonsense doesn’t', () => {
	assert.deepEqual(bootMarksFrom(`?boot=${T}.${T + 2500}`), { kiosk: T, reached: T + 2500 });
	assert.deepEqual(bootMarksFrom('?boot=12.x'), {});
	assert.deepEqual(bootMarksFrom(''), {});
});

test('the server adds its own marks only to the boot it came up with', () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'boot-'));
	let t = T + 20000;
	const log = createBootLog({ dataDir, now: () => t, systemUptime: () => 20, processUptime: () => 8, log() {} });
	log.listening();
	const boot = log.record({ kiosk: T + 15000, reached: T + 20100, page: T + 20200, awake: T + 21500 });
	assert.equal(boot.kind, 'boot');
	assert.equal(boot.power, T);
	assert.equal(boot.server, T + 12000);
	// hours later the kiosk alone restarts: not timed from power on
	t += 3 * 3600_000;
	const later = log.record({ kiosk: t - 5000, reached: t - 1000, page: t - 900, awake: t });
	assert.equal(later.kind, 'kiosk');
	assert.equal(later.power, undefined);
	assert.equal(log.read().length, 2);
	assert.equal(log.read()[0].kind, 'kiosk', 'newest first');
});
