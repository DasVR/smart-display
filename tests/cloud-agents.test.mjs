import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { identifyAgent } from '../src/lib/agentRoster.js';
import {
	applyCloudHint,
	cloudDemoRoster,
	isCloudWorkingStatus,
	normalizeCloudItems,
	snapshotFromPayloads,
	summarizeCloudLane
} from '../src/lib/cloudAgents.js';
import { ingestCloudSnapshot, resetAgentRoster } from '../src/lib/server/agentRosterState.js';
import { loadCloudSnapshot, resetCloudSnapshotCache } from '../src/lib/server/cloudAgentsPoll.js';
import { emptyRoster } from '../src/lib/agentRoster.js';

const LIVE_MCP = {
	agents: [
		{
			bcId: 'bc-d98c2832-325c-502e-9ac1-3f1f33b3d41f',
			name: 'Verify Agents stage UI',
			status: 'IDLE',
			updatedAtMs: 1
		},
		{
			bcId: 'bc-1b8c1b69-1d25-440c-b37b-56a3f2e85d71',
			name: 'Smart display efficiency',
			status: 'RUNNING',
			updatedAtMs: 1789834415036,
			source: 'web'
		}
	]
};

test('identifyAgent maps cloud code onto Cursor', () => {
	assert.equal(identifyAgent('Cursor Cloud'), 'cursor');
	assert.equal(identifyAgent('Claude Code Cloud'), 'claude');
	assert.equal(identifyAgent('Cloud Code'), 'cursor');
	assert.equal(identifyAgent('cloud agent'), 'cursor');
});

test('isCloudWorkingStatus treats ACTIVE and RUNNING as in flight, not IDLE', () => {
	assert.equal(isCloudWorkingStatus('RUNNING'), true);
	assert.equal(isCloudWorkingStatus('ACTIVE'), true);
	assert.equal(isCloudWorkingStatus('CREATING'), true);
	assert.equal(isCloudWorkingStatus('WAITING_FOR_BACKGROUND_WORK'), true);
	assert.equal(isCloudWorkingStatus('IDLE'), false);
	assert.equal(isCloudWorkingStatus('FINISHED'), false);
	assert.equal(isCloudWorkingStatus('ARCHIVED'), false);
});

test('normalizeCloudItems reads Cursor v1, v0, and MCP lists', () => {
	const v1 = normalizeCloudItems({
		items: [{ id: 'bc-1', name: 'Add README', status: 'ACTIVE', updatedAt: '2026-04-13T18:45:00.000Z' }]
	});
	assert.equal(v1[0].id, 'bc-1');
	assert.equal(v1[0].status, 'ACTIVE');

	const v0 = normalizeCloudItems({
		agents: [{ id: 'bc_def', name: 'Fix auth', status: 'RUNNING', createdAt: '2024-01-15T11:45:00Z' }]
	});
	assert.equal(v0[0].name, 'Fix auth');

	const mcp = normalizeCloudItems(LIVE_MCP);
	assert.equal(mcp.length, 2);
	assert.equal(mcp.find((a) => a.id.includes('1b8c1b69')).name, 'Smart display efficiency');
});

test('summarizeCloudLane picks the newest running cloud agent', () => {
	const lane = summarizeCloudLane(normalizeCloudItems(LIVE_MCP));
	assert.equal(lane.working, true);
	assert.equal(lane.task, 'Smart display efficiency');
	assert.equal(lane.count, 1);
	assert.equal(lane.id, 'bc-1b8c1b69-1d25-440c-b37b-56a3f2e85d71');
});

test('two running Cursor cloud agents mention the extra count', () => {
	const lane = summarizeCloudLane(
		normalizeCloudItems({
			items: [
				{ id: 'a', name: 'First', status: 'ACTIVE', updatedAtMs: 20 },
				{ id: 'b', name: 'Second', status: 'RUNNING', updatedAtMs: 10 }
			]
		})
	);
	assert.equal(lane.task, 'First');
	assert.equal(lane.body, '2 cloud runs');
	assert.equal(lane.count, 2);
});

test('applyCloudHint puts a Cursor Cloud run on the Cursor card', () => {
	const snap = snapshotFromPayloads({ cursor: LIVE_MCP });
	const roster = applyCloudHint(emptyRoster(), snap, 50);
	const cursor = roster.find((a) => a.id === 'cursor');
	const claude = roster.find((a) => a.id === 'claude');
	assert.equal(cursor.phase, 'working');
	assert.equal(cursor.task, 'Smart display efficiency');
	assert.equal(cursor.source, 'Cursor Cloud');
	assert.equal(claude.phase, 'idle');
});

test('applyCloudHint flips a cloud run to finished when the box goes idle', () => {
	const busy = applyCloudHint(emptyRoster(), snapshotFromPayloads({ cursor: LIVE_MCP }), 10);
	const idle = applyCloudHint(busy, snapshotFromPayloads({ cursor: { agents: [] } }), 20);
	assert.equal(idle.find((a) => a.id === 'cursor').phase, 'done');
	assert.equal(idle.find((a) => a.id === 'cursor').task, 'finished');
});

test('applyCloudHint does not finish a local Cursor hook when cloud is quiet', () => {
	const local = emptyRoster().map((a) =>
		a.id === 'cursor'
			? { ...a, phase: 'working', task: 'editing locally', source: 'Cursor', updatedAt: 5 }
			: a
	);
	const next = applyCloudHint(local, snapshotFromPayloads({}), 9);
	assert.equal(next.find((a) => a.id === 'cursor').phase, 'working');
	assert.equal(next.find((a) => a.id === 'cursor').task, 'editing locally');
});

test('Claude cloud sessions land on the Claude Code card', () => {
	const snap = snapshotFromPayloads({
		claude: { sessions: [{ id: 'sesn_1', title: 'Polish Agents stage', status: 'running' }] }
	});
	const roster = applyCloudHint(emptyRoster(), snap, 1);
	assert.equal(roster.find((a) => a.id === 'claude').phase, 'working');
	assert.equal(roster.find((a) => a.id === 'claude').task, 'Polish Agents stage');
	assert.equal(roster.find((a) => a.id === 'claude').source, 'Claude Code Cloud');
});

test('ingestCloudSnapshot emits working then done once each', () => {
	resetAgentRoster();
	const start = ingestCloudSnapshot(snapshotFromPayloads({ cursor: LIVE_MCP }), 1);
	assert.equal(start.events.length, 1);
	assert.equal(start.events[0].kind, 'working');
	assert.equal(start.events[0].source, 'Cursor Cloud');
	assert.match(start.events[0].body, /Smart display efficiency/);

	const still = ingestCloudSnapshot(snapshotFromPayloads({ cursor: LIVE_MCP }), 2);
	assert.equal(still.events.length, 0);
	assert.equal(still.changed, false);

	const done = ingestCloudSnapshot(snapshotFromPayloads({ cursor: { items: [] } }), 3);
	assert.equal(done.events.length, 1);
	assert.equal(done.events[0].kind, 'done');
	resetAgentRoster();
});

test('cloudDemoRoster puts Cursor on the poster', () => {
	const demo = cloudDemoRoster(9);
	assert.equal(demo.find((a) => a.id === 'cursor').task, 'Smart display efficiency');
	assert.equal(demo.find((a) => a.id === 'cursor').phase, 'working');
});

test('loadCloudSnapshot reads a snapshot file and Cursor v1 JSON from the API', async () => {
	resetCloudSnapshotCache();
	const dir = mkdtempSync(path.join(os.tmpdir(), 'cloud-agents-'));
	const file = path.join(dir, 'cloud-agents.json');
	writeFileSync(file, JSON.stringify(LIVE_MCP));
	const fromFile = await loadCloudSnapshot({
		env: { CLOUD_AGENTS_SNAPSHOT: file, NODE_ENV: 'test' }
	});
	assert.equal(fromFile.cursor.working, true);
	assert.equal(fromFile.cursor.task, 'Smart display efficiency');

	const fromApi = await loadCloudSnapshot({
		env: { CURSOR_API_KEY: 'test-key', NODE_ENV: 'test' },
		fetchImpl: async (url) => {
			assert.match(url, /api\.cursor\.com\/v1\/agents/);
			return {
				items: [{ id: 'bc-9', name: 'Cloud Code run', status: 'ACTIVE', updatedAt: '2026-09-19T00:00:00.000Z' }]
			};
		}
	});
	assert.equal(fromApi.cursor.working, true);
	assert.equal(fromApi.cursor.task, 'Cloud Code run');
	resetCloudSnapshotCache();
});
