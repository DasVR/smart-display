import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISPLAY_QUALITY, LOAD_THRESHOLDS, evaluateDisplayLoad } from '../src/lib/displayLoad.js';

test('evaluateDisplayLoad stays full on a quiet box', () => {
	const next = evaluateDisplayLoad({ cpu: 12, ramPct: 40 });
	assert.equal(next.quality, DISPLAY_QUALITY.FULL);
	assert.equal(next.freezeShaders, false);
	assert.deepEqual(next.reasons, []);
});

test('evaluateDisplayLoad drops to eco when CPU is busy', () => {
	const next = evaluateDisplayLoad({ cpu: LOAD_THRESHOLDS.ecoCpu + 1, ramPct: 30 });
	assert.equal(next.quality, DISPLAY_QUALITY.ECO);
	assert.equal(next.freezeShaders, false);
	assert.ok(next.reasons.includes('cpu-eco'));
});

test('evaluateDisplayLoad freezes shaders on high CPU or RAM', () => {
	assert.equal(evaluateDisplayLoad({ cpu: 95, ramPct: 20 }).quality, DISPLAY_QUALITY.FROZEN);
	assert.equal(evaluateDisplayLoad({ cpu: 10, ramPct: 94 }).freezeShaders, true);
});

test('evaluateDisplayLoad freezes while Ollama is inferring or apt is installing', () => {
	assert.equal(evaluateDisplayLoad({ cpu: 8, ramPct: 20, inferring: true }).quality, DISPLAY_QUALITY.FROZEN);
	assert.equal(evaluateDisplayLoad({ cpu: 8, ramPct: 20, installing: true }).quality, DISPLAY_QUALITY.FROZEN);
});

test('evaluateDisplayLoad holds eco until CPU falls through hysteresis', () => {
	const busy = evaluateDisplayLoad({ cpu: 60, ramPct: 30 }, DISPLAY_QUALITY.FULL);
	assert.equal(busy.quality, DISPLAY_QUALITY.ECO);
	const stillWarm = evaluateDisplayLoad({ cpu: 48, ramPct: 30 }, DISPLAY_QUALITY.ECO);
	assert.equal(stillWarm.quality, DISPLAY_QUALITY.ECO);
	const quiet = evaluateDisplayLoad({ cpu: 20, ramPct: 30 }, DISPLAY_QUALITY.ECO);
	assert.equal(quiet.quality, DISPLAY_QUALITY.FULL);
});

test('evaluateDisplayLoad steps frozen down to eco instead of jumping to full', () => {
	const next = evaluateDisplayLoad({ cpu: 70, ramPct: 40, inferring: false }, DISPLAY_QUALITY.FROZEN);
	assert.equal(next.quality, DISPLAY_QUALITY.ECO);
	assert.equal(next.freezeShaders, false);
});
