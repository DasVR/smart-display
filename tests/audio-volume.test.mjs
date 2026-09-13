import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	applyVolumePayload,
	clampVolume,
	coerceVolume,
	getVolume,
	parseWpctlVolume,
	setMute,
	setVolume,
	volumeHttpStatus,
	volumeTargetFromStatus,
	volumeWpctlArgs
} from '../src/lib/server/audioVolume.js';
import { parseWpctlStatus } from '../src/lib/server/audioSinks.js';

const WPCTL_ANALOG_AND_DUMMY = `
Audio
 ├─ Sinks:
 │  *   54. Dummy Output                        [vol: 1.00]
 │      41. Built-in Audio Analog Stereo        [vol: 0.40]
 │      62. HDMI / DisplayPort 3 Output         [vol: 1.00]
`;

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

test('coerceVolume accepts numeric strings from JSON bodies', () => {
	assert.equal(coerceVolume(0.25), 0.25);
	assert.equal(coerceVolume('0.80'), 0.8);
	assert.equal(coerceVolume(''), null);
	assert.equal(coerceVolume(undefined), null);
});

test('volumeTargetFromStatus prefers analog over Dummy default', () => {
	const resolved = volumeTargetFromStatus(WPCTL_ANALOG_AND_DUMMY);
	assert.equal(resolved.target, '41');
	assert.equal(resolved.sinkId, 41);
	assert.match(resolved.sinkName, /Analog Stereo/);
	assert.equal(parseWpctlStatus(WPCTL_ANALOG_AND_DUMMY).find((s) => s.default)?.id, 54);
});

test('volumeWpctlArgs aim get/set/mute at the resolved sink id', () => {
	assert.deepEqual(volumeWpctlArgs('status'), ['status']);
	assert.deepEqual(volumeWpctlArgs('get', '41'), ['get-volume', '41']);
	assert.deepEqual(volumeWpctlArgs('set', '41', '0.55'), ['set-volume', '41', '0.55']);
	assert.deepEqual(volumeWpctlArgs('mute', '41', '1'), ['set-mute', '41', '1']);
});

function mockWpctl({ volumeText = 'Volume: 0.40\n', statusText = WPCTL_ANALOG_AND_DUMMY } = {}) {
	const calls = [];
	const execWpctl = (args) => {
		calls.push(args.slice());
		if (args[0] === 'status') return statusText;
		if (args[0] === 'get-volume') return volumeText;
		if (args[0] === 'set-volume' || args[0] === 'set-mute') return '';
		throw new Error(`unexpected wpctl ${args.join(' ')}`);
	};
	const env = { PATH: '/usr/bin', XDG_RUNTIME_DIR: '/run/user/1000' };
	return { calls, env, execWpctl };
}

test('getVolume reads the analog sink, not Dummy Output', () => {
	const { calls, env, execWpctl } = mockWpctl();
	const result = getVolume({ env, execWpctl });
	assert.equal(result.ok, true);
	assert.equal(result.volume, 0.4);
	assert.equal(result.muted, false);
	assert.equal(result.sinkId, 41);
	assert.deepEqual(
		calls.find((args) => args[0] === 'get-volume'),
		['get-volume', '41']
	);
});

test('setVolume writes the analog sink and unmutes', () => {
	const { calls, env, execWpctl } = mockWpctl({ volumeText: 'Volume: 0.55\n' });
	const result = setVolume(0.55, { env, execWpctl });
	assert.equal(result.ok, true);
	assert.equal(result.volume, 0.55);
	assert.deepEqual(
		calls.find((args) => args[0] === 'set-volume'),
		['set-volume', '41', '0.55']
	);
	assert.deepEqual(
		calls.find((args) => args[0] === 'set-mute'),
		['set-mute', '41', '0']
	);
});

test('setMute mutes the analog sink', () => {
	const { calls, env, execWpctl } = mockWpctl({ volumeText: 'Volume: 0.40 [MUTED]\n' });
	const result = setMute(true, { env, execWpctl });
	assert.equal(result.ok, true);
	assert.equal(result.muted, true);
	assert.deepEqual(
		calls.find((args) => args[0] === 'set-mute'),
		['set-mute', '41', '1']
	);
});

test('applyVolumePayload accepts string volumes and rejects empty bodies', () => {
	const { env, execWpctl } = mockWpctl({ volumeText: 'Volume: 0.20\n' });
	const ok = applyVolumePayload({ volume: '0.20' }, { env, execWpctl });
	assert.equal(ok.ok, true);
	assert.equal(ok.volume, 0.2);
	const bad = applyVolumePayload({}, { env, execWpctl });
	assert.equal(bad.ok, false);
	assert.equal(volumeHttpStatus(bad), 400);
	assert.equal(volumeHttpStatus({ ok: true, volume: 0.2, muted: false }), 200);
});
