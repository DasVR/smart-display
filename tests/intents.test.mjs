import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INTENTS, INTENT_GROUPS, describeIntents, groupedIntents, intentById, intentTool, resolveIntent } from '../src/lib/intents.js';
import { parseCommand } from '../src/lib/wallActions.js';
import { createTaskHub } from '../src/lib/server/taskHub.js';
import { createApprovalHub } from '../src/lib/server/approvalHub.js';
import { createActionHub } from '../src/lib/server/actionHub.js';

const quiet = { log() {}, warn() {}, error() {} };

test('every example phrase parses to its own intent', () => {
	for (const intent of INTENTS) {
		if (intent.ringing) continue;
		for (const phrase of intent.examples) {
			assert.equal(parseCommand(phrase)?.intent, intent.id, `"${phrase}" should be ${intent.id}`);
		}
	}
});

test('ids are unique and every group is known', () => {
	assert.equal(new Set(INTENTS.map((i) => i.id)).size, INTENTS.length);
	for (const i of INTENTS) assert.ok(INTENT_GROUPS.includes(i.group), i.id);
	assert.deepEqual(
		groupedIntents().map((g) => g.group),
		INTENT_GROUPS.filter((g) => INTENTS.some((i) => i.group === g))
	);
});

test('resolveIntent checks params, fills defaults and drops extras', () => {
	assert.deepEqual(resolveIntent('show', { view: 'weather', evil: 1 }), { action: { intent: 'show', view: 'weather' } });
	assert.match(resolveIntent('show', { view: 'kitchen' }).error, /view must be one of/);
	assert.match(resolveIntent('show', {}).error, /needs view/);
	assert.deepEqual(resolveIntent('snooze', { query: 'bins' }), { action: { intent: 'snooze', query: 'bins', minutes: 60 } });
	assert.match(resolveIntent('snooze', { minutes: 2.5 }).error, /whole number/);
	assert.deepEqual(resolveIntent('done'), { action: { intent: 'done', query: '' } });
	assert.match(resolveIntent('launch-rockets').error, /unknown intent/);
	assert.equal(intentById('volume').params.change.enum.includes('mute'), true);
});

test('describeIntents is plain data a caller cannot use to change the registry', () => {
	const list = describeIntents();
	list[0].examples.push('changed');
	list.find((i) => i.id === 'show').params.view.enum.push('kitchen');
	assert.ok(!INTENTS[0].examples.includes('changed'));
	assert.ok(!intentById('show').params.view.enum.includes('kitchen'));
});

test('the MCP tool lists every intent', () => {
	const tool = intentTool();
	assert.equal(tool.name, 'run_wall_intent');
	assert.deepEqual(tool.inputSchema.properties.intent.enum, INTENTS.map((i) => i.id));
	for (const i of INTENTS) assert.match(tool.description, new RegExp(`- ${i.id}: `));
});

test('actionHub runs intents by id', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'intents-'));
	const calls = [];
	const broadcast = () => {};
	const taskHub = createTaskHub({ dataDir, broadcast, log: quiet, env: {} });
	const approvalHub = createApprovalHub({ dataDir, broadcast, log: quiet, env: {} });
	const actionHub = createActionHub({
		dataDir,
		taskHub,
		approvalHub,
		broadcast,
		env: {},
		log: quiet,
		getState: () => ({ view: 'clock', hdmi: 'on' }),
		navigate: (v) => calls.push(v)
	});
	try {
		assert.deepEqual(await actionHub.runIntent('show', { view: 'music' }), { did: 'show', say: 'Showing music.' });
		assert.deepEqual(calls, ['music']);
		const bad = await actionHub.runIntent('show', { view: 'garage' });
		assert.match(bad.error, /view must be one of/);
		assert.match((await actionHub.runIntent('approval', { decision: 'allow' })).say, /Nothing is waiting/);
	} finally {
		approvalHub.stop();
	}
});
