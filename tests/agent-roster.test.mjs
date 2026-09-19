import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	applyNotifyToRoster,
	applyOllamaHint,
	demoRoster,
	emptyRoster,
	identifyAgent,
	isAgentStatusEvent,
	leadAgent,
	relativeAge,
	shouldOpenAgentsView,
	workingIslandActivity
} from '../src/lib/agentRoster.js';
import { swipeKioskView, KIOSK_VIEWS, canonicalizeKioskView } from '../src/lib/kioskViews.js';
import { hostPeekNeeded } from '../src/lib/hostPeek.js';

test('identifyAgent maps Claude Code, Cursor, Hermes, Ollama', () => {
	assert.equal(identifyAgent('Claude Code'), 'claude');
	assert.equal(identifyAgent('Cursor'), 'cursor');
	assert.equal(identifyAgent('Hermes'), 'hermes');
	assert.equal(identifyAgent('Ollama'), 'ollama');
	assert.equal(identifyAgent('', 'Claude Code finished'), 'claude');
	assert.equal(identifyAgent('npm'), null);
});

test('working then done updates the matching card only', () => {
	const now = 1_700_000_000_000;
	const working = applyNotifyToRoster(emptyRoster(), {
		kind: 'working',
		source: 'Claude Code',
		title: 'Claude Code working',
		body: 'Editing the Agents tab'
	}, now);
	const claude = working.find((a) => a.id === 'claude');
	const cursor = working.find((a) => a.id === 'cursor');
	assert.equal(claude.phase, 'working');
	assert.equal(claude.task, 'Editing the Agents tab');
	assert.equal(claude.updatedAt, now);
	assert.equal(cursor.phase, 'idle');

	const done = applyNotifyToRoster(working, {
		kind: 'done',
		source: 'Claude Code',
		title: 'Claude Code finished'
	}, now + 5000);
	assert.equal(done.find((a) => a.id === 'claude').phase, 'done');
	assert.equal(done.find((a) => a.id === 'claude').task, 'finished');
	assert.equal(done.find((a) => a.id === 'cursor').phase, 'idle');
});

test('shouldOpenAgentsView is true for Cursor and Claude, not Ollama', () => {
	assert.equal(shouldOpenAgentsView({ kind: 'done', source: 'Cursor', title: 'Cursor finished' }), true);
	assert.equal(shouldOpenAgentsView({ kind: 'working', source: 'Claude Code' }), true);
	assert.equal(shouldOpenAgentsView({ kind: 'done', source: 'Ollama', title: 'Agent finished' }), false);
	assert.equal(shouldOpenAgentsView({ kind: 'install', source: 'apt' }), false);
});

test('isAgentStatusEvent covers working, done, and finished titles', () => {
	assert.equal(isAgentStatusEvent({ kind: 'working' }), true);
	assert.equal(isAgentStatusEvent({ kind: 'done' }), true);
	assert.equal(isAgentStatusEvent({ title: 'Cursor finished' }), true);
	assert.equal(isAgentStatusEvent({ kind: 'volume' }), false);
});

test('applyOllamaHint follows inferring then idle', () => {
	const now = 50;
	const busy = applyOllamaHint(emptyRoster(), 'inferring', now);
	assert.equal(busy.find((a) => a.id === 'ollama').phase, 'working');
	assert.equal(busy.find((a) => a.id === 'claude').phase, 'idle');
	const idle = applyOllamaHint(busy, 'idle', now + 10);
	assert.equal(idle.find((a) => a.id === 'ollama').phase, 'done');
});

test('workingIslandActivity names the live agents', () => {
	const roster = applyNotifyToRoster(emptyRoster(), {
		kind: 'working',
		source: 'Cursor',
		title: 'Cursor working',
		body: 'reviewing PR'
	}, 1);
	assert.deepEqual(workingIslandActivity(roster), {
		id: 'agents',
		kind: 'status',
		title: 'Cursor',
		body: 'reviewing PR',
		severity: 'info'
	});
	assert.equal(workingIslandActivity(emptyRoster()), null);
});

test('relativeAge and demo roster stay readable', () => {
	assert.equal(relativeAge(0, 1000), 'no signal');
	assert.equal(relativeAge(1000, 1000), 'just now');
	assert.equal(relativeAge(1000, 13000), '12s ago');
	const demo = demoRoster(20_000);
	assert.equal(demo.find((a) => a.id === 'claude').phase, 'working');
	assert.equal(demo.find((a) => a.id === 'cursor').phase, 'done');
});

test('swipe order is Clock School Agents Music Weather', () => {
	assert.deepEqual(KIOSK_VIEWS, ['clock', 'school', 'agents', 'music', 'weather']);
	assert.equal(canonicalizeKioskView('dev'), 'agents');
	assert.equal(swipeKioskView('school', 'left'), 'agents');
	assert.equal(swipeKioskView('agents', 'left'), 'music');
	assert.equal(swipeKioskView('dev', 'left'), 'music');
	assert.equal(swipeKioskView('clock', 'right'), 'weather');
});

test('leadAgent prefers a working card, then the latest finish', () => {
	const now = 1000;
	const roster = applyNotifyToRoster(
		applyNotifyToRoster(
			emptyRoster(),
			{ kind: 'done', source: 'Cursor', title: 'Cursor finished', body: 'PR checks green' },
			now
		),
		{ kind: 'working', source: 'Claude Code', title: 'Claude Code working', body: 'stage rewrite' },
		now + 10
	);
	assert.equal(leadAgent(roster).id, 'claude');
	const doneOnly = applyNotifyToRoster(emptyRoster(), {
		kind: 'done',
		source: 'Cursor',
		title: 'Cursor finished'
	}, now);
	assert.equal(leadAgent(doneOnly).id, 'cursor');
	assert.equal(leadAgent(emptyRoster()), null);
});

test('hostPeekNeeded opens for load, quality, or a down service', () => {
	assert.equal(hostPeekNeeded({}), false);
	assert.equal(hostPeekNeeded({ cpu: 60 }), true);
	assert.equal(hostPeekNeeded({ ramPct: 80 }), true);
	assert.equal(hostPeekNeeded({ quality: 'eco' }), true);
	assert.equal(hostPeekNeeded({ services: [{ name: 'ha', status: false }] }), true);
	assert.equal(hostPeekNeeded({ services: [{ name: 'ha', status: true }] }), false);
	assert.equal(hostPeekNeeded({ force: true }), true);
	assert.equal(hostPeekNeeded({ error: true }), true);
	assert.equal(hostPeekNeeded({ quality: 'frozen' }), true);
});
