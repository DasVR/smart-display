import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

import { DISPLAY_QUALITY } from '../src/lib/displayLoad.js';
import {
	applyLoadSample,
	displayQuality,
	gpuLowPowerMode
} from '../src/lib/services/ollamaArbiter.js';

test('applyLoadSample freezes shaders while inferring', () => {
	applyLoadSample({ cpu: 10, ramPct: 20, inferring: true });
	assert.equal(get(displayQuality), DISPLAY_QUALITY.FROZEN);
	assert.equal(get(gpuLowPowerMode), true);
});

test('applyLoadSample trusts a server quality tier', () => {
	applyLoadSample({ cpu: 12, ramPct: 20, inferring: false, installing: false, quality: 'eco' });
	assert.equal(get(displayQuality), DISPLAY_QUALITY.ECO);
	assert.equal(get(gpuLowPowerMode), false);
});

test('applyLoadSample returns to full on a quiet sample', () => {
	applyLoadSample({ cpu: 8, ramPct: 20, inferring: false, installing: false, quality: 'full' });
	assert.equal(get(displayQuality), DISPLAY_QUALITY.FULL);
	assert.equal(get(gpuLowPowerMode), false);
});

test('applyLoadSample keeps shaders frozen while installing even if quality says full', () => {
	applyLoadSample({ cpu: 8, ramPct: 20, inferring: false, installing: true, quality: 'full' });
	assert.equal(get(displayQuality), DISPLAY_QUALITY.FROZEN);
	assert.equal(get(gpuLowPowerMode), true);
	applyLoadSample({ cpu: 8, ramPct: 20, inferring: false, installing: false, quality: 'full' });
	assert.equal(get(displayQuality), DISPLAY_QUALITY.FULL);
});
