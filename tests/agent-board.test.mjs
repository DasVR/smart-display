import test from 'node:test';
import assert from 'node:assert/strict';
import { DONE_FOR_MS, agentBoard, boardSummary, demoSessions, elapsed, plainStep, sessionLane } from '../src/lib/agentBoard.js';
import { applyHook, readHook, todoProgress, safeLink, withCursorCloud } from '../src/lib/agentHooks.js';

const NOW = Date.parse('2026-10-22T15:00:00Z');
const m = 60000;

test('every session is its own lane: two Claude Codes and a Cursor cloud agent', () => {
	const sessions = [
		{ agent: 'claude', session: 'a', phase: 'working', task: 'Bash: npm test', prompt: 'fix the tests', project: 'app', since: NOW - 5 * m, at: NOW },
		{ agent: 'claude', session: 'b', phase: 'working', task: 'Edit: page.svelte', title: 'Redesign the page', project: 'site', remote: true, since: NOW - 20 * m, at: NOW },
		{ agent: 'cursor', session: 'cloud-x', phase: 'working', task: 'Fix flaky test', title: 'Fix flaky test', remote: true, since: NOW - 2 * m, at: NOW }
	];
	const { lanes, counts, more } = agentBoard({ sessions, now: NOW });
	assert.deepEqual(lanes.map((l) => l.key), ['claude:b', 'claude:a', 'cursor:cloud-x'], 'the longest-running first, so lanes stay put');
	assert.deepEqual([counts.working, counts.waiting, more], [3, 0, 0]);
	assert.deepEqual([lanes[0].headline, lanes[0].step, lanes[0].where, lanes[0].character], ['Redesign the page', 'Editing page.svelte', 'site · cloud', 'claude']);
	assert.equal(lanes[1].headline, 'Fix the tests', 'what you asked, when the agent has said nothing itself');
	assert.equal(lanes[2].step, '', 'a step the same as the headline is said once');
});

test('needs you first, finished last, long-finished gone, the rest counted', () => {
	const sessions = [
		{ agent: 'claude', session: 'done-old', phase: 'done', prompt: 'old', at: NOW - DONE_FOR_MS - 1 },
		{ agent: 'claude', session: 'done', phase: 'done', prompt: 'readme', at: NOW - 2 * m },
		{ agent: 'cursor', session: 'w', phase: 'working', task: 'Working', since: NOW - m, at: NOW },
		{ agent: 'claude', session: 'q', phase: 'waiting', task: 'Allow: git push', since: NOW, at: NOW }
	];
	const board = agentBoard({ sessions, now: NOW });
	assert.deepEqual(board.lanes.map((l) => l.key), ['claude:q', 'cursor:w', 'claude:done']);
	assert.equal(board.lanes[0].step, 'Allow: git push');
	const many = Array.from({ length: 9 }, (_, i) => ({ agent: 'claude', session: `s${i}`, phase: 'working', since: NOW - i, at: NOW }));
	const full = agentBoard({ sessions: many, now: NOW, max: 6 });
	assert.deepEqual([full.lanes.length, full.more], [6, 3]);
});

test('Hermes and Ollama come from the roster, when they have said something', () => {
	const roster = [
		{ id: 'claude', phase: 'working', updatedAt: NOW },
		{ id: 'hermes', name: 'Hermes', phase: 'working', task: 'Writing the weekly summary', body: '', updatedAt: NOW - m },
		{ id: 'ollama', name: 'Ollama', phase: 'idle', task: 'standby', updatedAt: 0 }
	];
	const { lanes } = agentBoard({ roster, now: NOW });
	assert.deepEqual(lanes.map((l) => [l.key, l.character, l.headline]), [['hermes', 'hermes', 'Writing the weekly summary']]);
});

test('plainStep reads tool lines as plain words', () => {
	assert.equal(plainStep('Bash: npm test'), 'Running npm test');
	assert.equal(plainStep('Edit: AgentsHub.svelte'), 'Editing AgentsHub.svelte');
	assert.equal(plainStep('Thinking'), 'Thinking');
	assert.equal(sessionLane({ agent: 'claude', session: 'x', phase: 'done', task: 'finished' }).step, '');
});

test('elapsed and the summary line', () => {
	assert.equal(elapsed(NOW - 30000, NOW), 'now');
	assert.equal(elapsed(NOW - 12 * m, NOW), '12m');
	assert.equal(elapsed(NOW - 65 * m, NOW), '1h 5m');
	assert.equal(elapsed(NOW - 120 * m, NOW), '2h');
	assert.equal(boardSummary({ working: 2, waiting: 1 }), '1 needs you · 2 working');
	assert.equal(boardSummary({}), 'All quiet');
});

test('the demo board is a real board', () => {
	const board = agentBoard({ sessions: demoSessions(NOW), now: NOW });
	assert.equal(board.lanes[0].phase, 'waiting');
	assert.equal(board.lanes.length, 4);
});

/* ---------- what the agents say about themselves ---------- */

test('Claude Code’s to-do list is the step and the progress', () => {
	const todos = [
		{ content: 'Read the view', status: 'completed', activeForm: 'Reading the view' },
		{ content: 'Build the lanes', status: 'in_progress', activeForm: 'Building the lanes' },
		{ content: 'Write tests', status: 'pending', activeForm: 'Writing tests' }
	];
	assert.deepEqual(todoProgress(todos), { step: 'Building the lanes', done: 1, total: 3 });
	assert.equal(todoProgress([]), null);
	const step = readHook({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'TodoWrite', tool_input: { todos } });
	assert.deepEqual([step.task, step.progress], ['Building the lanes', { done: 1, total: 3 }]);
	// later tool steps keep the progress, a new prompt clears it
	let sessions = applyHook({}, step, NOW);
	sessions = applyHook(sessions, readHook({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } }), NOW + 1);
	assert.deepEqual(sessions['claude:s'].progress, { done: 1, total: 3 });
	sessions = applyHook(sessions, readHook({ hook_event_name: 'Stop', session_id: 's' }), NOW + 2);
	sessions = applyHook(sessions, readHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'next thing' }), NOW + 3);
	assert.equal(sessions['claude:s'].progress, null);
});

test('a report is a headline, a step, progress and a link; the headline outlasts the steps', () => {
	const report = readHook({ hook_event_name: 'WallReport', agent: 'cursor', session_id: 'c1', summary: 'Fix the flaky weather test', step: 'Reproducing it', done: 1, total: 4, link: 'https://github.com/x/y/pull/9' });
	assert.deepEqual(
		[report.agent, report.title, report.task, report.progress, report.link],
		['cursor', 'Fix the flaky weather test', 'Reproducing it', { done: 1, total: 4 }, 'https://github.com/x/y/pull/9']
	);
	let sessions = applyHook({}, report, NOW);
	sessions = applyHook(sessions, readHook({ hook_event_name: 'afterShellExecution', conversation_id: 'c1', command: 'npm test' }), NOW + 1);
	const s = sessions['cursor:c1'];
	assert.deepEqual([s.title, s.task, s.link], ['Fix the flaky weather test', 'Shell: npm test', 'https://github.com/x/y/pull/9']);
	assert.equal(readHook({ hook_event_name: 'WallReport', session_id: 'z' }), null, 'an empty report says nothing');
	assert.equal(readHook({ hook_event_name: 'WallReport', session_id: 'z', summary: 'x', done: 5, total: 2 }).progress, undefined, 'nonsense progress is dropped');
	assert.equal(readHook({ hook_event_name: 'WallReport', session_id: 'z', summary: 'x', phase: 'done' }).phase, 'done');
	assert.equal(safeLink('javascript:alert(1)'), '');
});

test('Cursor’s cloud agents bring their repo and pull request', () => {
	const items = [{ id: 'bc1', name: 'Fix flaky test', status: 'ACTIVE', updatedAt: new Date(NOW).toISOString(), source: { repository: 'github.com/dasvr/smart-display' }, target: { prUrl: 'https://github.com/dasvr/smart-display/pull/3' } }];
	const s = withCursorCloud({}, items, NOW)['cursor:cloud-bc1'];
	assert.deepEqual([s.title, s.project, s.link, s.remote], ['Fix flaky test', 'smart-display', 'https://github.com/dasvr/smart-display/pull/3', true]);
});
