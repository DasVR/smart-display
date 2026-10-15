import test from 'node:test';
import assert from 'node:assert/strict';
import { castFor, countdown, speakerOf } from '../src/lib/agentStage.js';

const roster = [
	{ id: 'claude', name: 'Claude Code', phase: 'working', task: 'npm test' },
	{ id: 'cursor', name: 'Cursor', phase: 'idle', task: 'standby' },
	{ id: 'hermes', name: 'Hermes', phase: 'working', task: 'thinking' },
	{ id: 'ollama', name: 'Ollama', phase: 'working', task: 'inferring' }
];

test('working agents sit at their laptops; agents without a character stay off stage', () => {
	assert.deepEqual(castFor({ roster }), [{ character: 'claude', name: 'Claude Code', target: 'work', task: 'npm test', approval: null, waiting: 0 }]);
	assert.deepEqual(castFor({}), []);
});

test('a question stands its agent up, even one that wasn’t working', () => {
	const approvals = [
		{ id: 'p2', source: 'Cursor', title: 'Apply edit?', status: 'pending', createdAt: '2026-10-15T14:01:00Z' },
		{ id: 'p1', source: 'Claude Code', title: 'Run tests?', status: 'pending', createdAt: '2026-10-15T14:00:00Z' },
		{ id: 'p3', source: 'Claude Code', title: 'git push?', status: 'pending', createdAt: '2026-10-15T14:02:00Z' },
		{ id: 'old', source: 'Claude Code', title: 'done', status: 'allow' }
	];
	const cast = castFor({ roster, approvals });
	assert.deepEqual(cast.map((c) => [c.character, c.target, c.approval?.id, c.waiting]), [
		['claude', 'ask', 'p1', 1],
		['cursor', 'ask', 'p2', 0]
	]);
	assert.equal(speakerOf(cast).approval.id, 'p1', 'the oldest question speaks first');
	assert.equal(speakerOf([]), null);
});

test('an approval from an agent with no character is asked by Clawd', () => {
	const cast = castFor({ approvals: [{ id: 'x', source: 'Hermes', title: 'Send email?', status: 'pending' }] });
	assert.equal(cast[0].character, 'claude');
	assert.equal(cast[0].name, 'Hermes');
});

test('the order is always Claude, Cursor, Gemini', () => {
	const cast = castFor({
		roster: [
			{ id: 'cursor', name: 'Cursor', phase: 'working' },
			{ id: 'claude', name: 'Claude Code', phase: 'working' }
		],
		approvals: [{ id: 'g', source: 'Gemini', title: 'Push?', status: 'pending' }]
	});
	assert.deepEqual(cast.map((c) => c.character), ['claude', 'cursor', 'gemini']);
});

test('countdown', () => {
	const now = Date.parse('2026-10-15T14:00:00Z');
	assert.equal(countdown('2026-10-15T14:02:05Z', now), '2:05');
	assert.equal(countdown('2026-10-15T14:00:45Z', now), '45s');
	assert.equal(countdown('2026-10-15T13:59:00Z', now), '0s');
	assert.equal(countdown('nope', now), '');
});

test('onlyAsking keeps just the characters with a question', () => {
	const cast = castFor({ roster, approvals: [{ id: 'q', source: 'Cursor', title: 'Apply?', status: 'pending' }], onlyAsking: true });
	assert.deepEqual(cast.map((c) => c.character), ['cursor']);
	assert.deepEqual(castFor({ roster, onlyAsking: true }), []);
});
