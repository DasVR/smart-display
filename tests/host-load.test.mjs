import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	cpuPercentFromDelta,
	createHostLoadSampler,
	parseProcStat,
	ramStats
} from '../src/lib/server/hostLoad.js';

const STAT_IDLE = 'cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 50 0 50 400 0 0 0 0 0 0\n';
const STAT_BUSY = 'cpu  250 0 250 900 0 0 0 0 0 0\ncpu0 125 0 125 450 0 0 0 0 0 0\n';

test('parseProcStat reads the aggregate cpu line', () => {
	const snap = parseProcStat(STAT_IDLE);
	assert.equal(snap.idle, 800);
	assert.equal(snap.total, 1000);
});

test('cpuPercentFromDelta reports busy time between samples', () => {
	const a = parseProcStat(STAT_IDLE);
	const b = parseProcStat(STAT_BUSY);
	const pct = cpuPercentFromDelta(a, b);
	assert.ok(Math.abs(pct - 75) < 0.1);
});

test('ramStats converts bytes to GB and a percent', () => {
	const stats = ramStats(16 * 1024 ** 3, 4 * 1024 ** 3);
	assert.equal(stats.ram_total, 16);
	assert.equal(stats.ram_used, 12);
	assert.equal(stats.ramPct, 75);
});

test('createHostLoadSampler needs two ticks before CPU is real', () => {
	const readings = [STAT_IDLE, STAT_BUSY];
	let i = 0;
	const sample = createHostLoadSampler({
		readStat: () => readings[Math.min(i++, readings.length - 1)],
		totalmem: () => 8 * 1024 ** 3,
		freemem: () => 4 * 1024 ** 3
	});
	const first = sample();
	assert.equal(first.cpuReady, false);
	assert.equal(first.ramPct, 50);
	const second = sample();
	assert.equal(second.cpuReady, true);
	assert.equal(second.cpu, 75);
});
