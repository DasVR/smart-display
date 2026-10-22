import test from 'node:test';
import assert from 'node:assert/strict';
import { bayer, ditherLit, meterTone } from '../src/lib/ditherMeter.js';

const lit = (pos, level, band) => {
	let n = 0;
	for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) n += ditherLit(x, y, pos, level, band) ? 1 : 0;
	return n;
};

test('the Bayer thresholds cover 0..1 evenly', () => {
	const all = [];
	for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) all.push(bayer(x, y));
	assert.deepEqual(all.sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => (i + 0.5) / 16));
});

test('well inside the level is solid, well past it is empty, the edge is dithered', () => {
	assert.equal(lit(0.2, 0.6, 0.06), 16);
	assert.equal(lit(0.9, 0.6, 0.06), 0);
	const edge = lit(0.6, 0.6, 0.06);
	assert.ok(edge > 4 && edge < 12, `about half lit at the edge, got ${edge}`);
	assert.equal(lit(0.01, 0, 0.06), 0, 'nothing lit at zero');
});

test('the colour follows the load unless one is asked for', () => {
	assert.equal(meterTone('auto', 20), 'ok');
	assert.equal(meterTone('auto', 70), 'scan');
	assert.equal(meterTone('auto', 92), 'warn');
	assert.equal(meterTone('brand', 92), 'brand');
});
