import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

import { readHdmiStamp, setPanelPower, writeHdmiStamp } from '../src/lib/server/displayPower.js';

const tmpDirs = [];

after(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

test('setPanelPower stamps desired state and runs the matching script', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'display-power-'));
	tmpDirs.push(dir);
	const stamp = path.join(dir, 'hdmi');
	const ran = [];
	const state = await setPanelPower(false, {
		stampPath: stamp,
		script: '/bin/true',
		execFile: async (script) => {
			ran.push(script);
		}
	});
	assert.equal(state, 'off');
	assert.equal(readFileSync(stamp, 'utf8'), 'off');
	assert.deepEqual(ran, ['/bin/true']);
	writeHdmiStamp('on', stamp);
	assert.equal(readFileSync(stamp, 'utf8'), 'on');
	assert.equal(readHdmiStamp(stamp), 'on');
	assert.equal(readHdmiStamp(path.join(dir, 'missing')), 'unknown');
});
