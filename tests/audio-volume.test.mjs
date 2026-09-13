import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampVolume, parseWpctlVolume } from '../src/lib/server/audioVolume.js';

test('parseWpctlVolume reads a plain volume line', () => {
	assert.deepEqual(parseWpctlVolume('Volume: 0.65\n'), { volume: 0.65, muted: false });
});

test('parseWpctlVolume flags a muted sink', () => {
	assert.deepEqual(parseWpctlVolume('Volume: 0.40 [MUTED]\n'), { volume: 0.4, muted: true });
});

test('parseWpctlVolume returns null when unparsable', () => {
	assert.equal(parseWpctlVolume(''), null);
	assert.equal(parseWpctlVolume('no such sink'), null);
});

test('clampVolume keeps values within wpctl bounds', () => {
	assert.equal(clampVolume(-1), 0);
	assert.equal(clampVolume(0.5), 0.5);
	assert.equal(clampVolume(2), 1.5);
	assert.equal(clampVolume(NaN), 0);
});
