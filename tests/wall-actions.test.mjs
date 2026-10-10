import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMenu, findMenuItem, matchTask, parseCommand, pickPress, speakBoard } from '../src/lib/wallActions.js';
import { createTaskHub } from '../src/lib/server/taskHub.js';
import { createApprovalHub } from '../src/lib/server/approvalHub.js';
import { createActionHub } from '../src/lib/server/actionHub.js';

const quiet = { log() {}, warn() {}, error() {} };

test('spoken commands, and what is left to add', () => {
	assert.deepEqual(parseCommand("I'm done with the bins"), { intent: 'done', query: 'the bins' });
	assert.deepEqual(parseCommand('finished the dishes'), { intent: 'done', query: 'the dishes' });
	assert.deepEqual(parseCommand('mark feed the cat as done'), { intent: 'done', query: 'feed the cat' });
	assert.deepEqual(parseCommand('the laundry is done'), { intent: 'done', query: 'the laundry' });
	assert.deepEqual(parseCommand('done'), { intent: 'done', query: '' });
	assert.deepEqual(parseCommand('snooze the cat for 2 hours'), { intent: 'snooze', query: 'the cat', minutes: 120 });
	assert.deepEqual(parseCommand('snooze the plants until tomorrow'), { intent: 'snooze', query: 'the plants', minutes: 1440 });
	assert.deepEqual(parseCommand('snooze'), { intent: 'snooze', query: '', minutes: 60 });
	assert.deepEqual(parseCommand("what's on the wall?"), { intent: 'brief' });
	assert.deepEqual(parseCommand("I'm leaving"), { intent: 'board' });
	assert.deepEqual(parseCommand('what do I need to bring'), { intent: 'board' });
	assert.deepEqual(parseCommand('show me the radar'), { intent: 'show', view: 'weather' });
	assert.deepEqual(parseCommand('pause the music'), { intent: 'music', action: 'pause' });
	assert.deepEqual(parseCommand('skip this song'), { intent: 'music', action: 'next' });
	assert.deepEqual(parseCommand('goodnight'), { intent: 'screen', state: 'off' });
	assert.deepEqual(parseCommand('allow it'), { intent: 'approval', decision: 'allow' });

	for (const add of ['remind me to call mom at 5', 'take out the bins every monday', 'water the plants tomorrow', 'add a chore to vacuum', 'Stop by the store']) {
		assert.equal(parseCommand(add), null, add);
	}
});

test('matching a spoken phrase to a task', () => {
	const views = [
		{ id: 'a', title: 'Take out the bins', status: 'upcoming' },
		{ id: 'b', title: 'Feed the cat', status: 'overdue' },
		{ id: 'c', title: 'Feed the fish', status: 'today' },
		{ id: 'd', title: 'Water the plants', status: 'done' }
	];
	assert.equal(matchTask(views, 'the bins').id, 'a');
	assert.equal(matchTask(views, 'cat').id, 'b');
	assert.equal(matchTask(views, 'feeding').id, 'b', 'ties go to the more urgent one');
	assert.equal(matchTask(views, 'plants'), null, 'done items are skipped');
	assert.equal(matchTask(views, 'dentist'), null);
});

test('the menu is built from what is on the wall', () => {
	const ctx = {
		tasks: [
			{ id: 'b', title: 'Feed the cat', status: 'overdue' },
			{ id: 'c', title: 'Water the plants', status: 'today' },
			{ id: 'u', title: 'Dentist', status: 'upcoming' }
		],
		approvals: [{ id: 'ap', source: 'Claude Code', title: 'Run a command?', detail: 'git push origin main' }],
		board: null,
		nowPlaying: { playing: true, title: 'Kyoto' },
		view: 'music',
		hdmi: 'on'
	};
	assert.deepEqual(
		buildMenu(ctx).map((i) => i.label),
		[
			'Tell the wall',
			'Allow: git push origin main',
			'Deny: git push origin main',
			'Done: Feed the cat',
			'Done: Water the plants',
			'Snooze 1 h: Feed the cat',
			"What's waiting?",
			"What's tomorrow?",
			"What's the weather?",
			'Pause music',
			'Next song',
			'Show the weather',
			'Show the clock',
			'Screen off'
		]
	);
	const items = buildMenu(ctx);
	assert.equal(findMenuItem(items, 'done: feed the cat').taskId, 'b', 'case-insensitive');
	assert.equal(findMenuItem(items, 'next').action, 'next', 'by id too');
	assert.equal(findMenuItem(items, 'Launch rockets'), null);

	const board = { taskId: 'lv', title: 'School', minutes: 6, rows: [] };
	const withBoard = buildMenu({ ...ctx, approvals: [], board, nowPlaying: null, view: 'clock', hdmi: 'off' }).map((i) => i.label);
	assert.deepEqual(withBoard.slice(0, 3), ['Tell the wall', 'Read me the board', 'Leaving now (School)']);
	assert.ok(withBoard.includes('Screen on'));
	assert.ok(!withBoard.includes('Show the clock'));
});

test('one press: approvals are read out, never allowed; then board, then the top chore, then the brief', () => {
	assert.equal(pickPress({ approvals: [{ id: 'x' }], board: {}, tasks: [] }).intent, 'approval-read');
	assert.deepEqual(pickPress({ board: { taskId: 'lv' }, tasks: [] }), { intent: 'board', show: true });
	assert.deepEqual(pickPress({ tasks: [{ id: 'b', status: 'overdue' }] }), { intent: 'done', taskId: 'b' });
	assert.equal(pickPress({ tasks: [{ id: 'c', status: 'today' }] }).intent, 'brief');
});

test('the board, out loud', () => {
	const board = {
		title: 'School',
		minutes: 6,
		rows: [
			{ status: 'bring', label: 'PE kit' },
			{ status: 'bring', label: 'Umbrella' },
			{ status: 'do', label: 'Feed the cat' },
			{ status: 'due', label: 'Physics lab report' }
		]
	};
	assert.equal(speakBoard(board), 'Leave for school in 6 minutes. Bring PE kit and Umbrella. First: Feed the cat. Due today: Physics lab report.');
	assert.equal(speakBoard({ title: 'Practice', minutes: 0, rows: [] }), 'Time to go to practice. Nothing to bring. Have a good one.');
});

test('HTTP: press, menu, run, and commands through /api/tasks/say', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'act-'));
	const nowRef = { t: new Date(2026, 9, 9, 7, 20).getTime() };
	const sent = [];
	const calls = [];
	const broadcast = (m) => sent.push(m);
	let actionHub;
	const taskHub = createTaskHub({ dataDir, broadcast, log: quiet, now: () => nowRef.t, env: {}, commands: (t) => actionHub.command(t) });
	const approvalHub = createApprovalHub({ dataDir, broadcast, log: quiet, now: () => nowRef.t, env: {} });
	let view = 'music';
	actionHub = createActionHub({
		dataDir,
		taskHub,
		approvalHub,
		broadcast,
		now: () => nowRef.t,
		env: {},
		log: quiet,
		getState: () => ({ nowPlaying: { playing: true, title: 'Kyoto' }, view, hdmi: 'on' }),
		navigate: (v) => (view = v),
		player: async (a) => (calls.push(a), { ok: true }),
		screen: async (s) => calls.push(`screen:${s}`),
		loadWeather: async () => ({ hourly: [], prediction: { rain30min: 0.6 } }),
		loadEvents: async () => []
	});
	const server = createServer(async (req, res) => {
		if (await taskHub.handleHttp(req, res)) return;
		if (await actionHub.handleHttp(req, res)) return;
		res.writeHead(404);
		res.end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const text = async (method, p, body, headers = {}) =>
		(await fetch(`${base}${p}${p.includes('?') ? '&' : '?'}format=text`, { method, body, headers })).text();
	try {
		const at = (h, m = 0) => new Date(2026, 9, 9, h, m).toISOString();
		taskHub.create({ title: 'Feed the cat', at: at(7), repeat: 'daily' });
		taskHub.create({ title: 'Take out the bins', at: at(18) });

		// press with something overdue: ticks it off
		assert.match(await text('POST', '/api/action'), /^Done: Feed the cat\. Next time: tomorrow at 7 AM\. Nothing else waiting\.$/);
		assert.ok(sent.some((m) => m.type === 'notify' && m.title === 'Done: Feed the cat' && m.source === 'iPhone'), 'the press flashes on the wall');

		// a departure comes up: press reads the board and brings it forward
		taskHub.create({ title: 'Leave for school', kind: 'alert', at: at(7, 40), notes: 'PE kit' });
		assert.equal(await text('POST', '/api/action'), 'Leave for school in 20 minutes. Bring PE kit and Umbrella.');
		assert.equal(view, 'clock');

		// the menu, one label per line
		const lines = (await text('GET', '/api/action/menu')).split('\n');
		assert.deepEqual(lines.slice(0, 6), ['Tell the wall', 'Undo: Done Feed the cat', 'Read me the board', 'Leaving now (School)', 'Done: Take out the bins', "What's waiting?"]);
		assert.ok(lines.includes('Pause music'));

		assert.equal(await text('POST', '/api/action/run', 'Pause music', { 'Content-Type': 'text/plain' }), 'Paused.');
		assert.deepEqual(calls, ['pause']);
		assert.equal(await text('POST', '/api/action/run', JSON.stringify({ choice: 'Nope' })), 'That choice has gone; the wall changed. Try again.');

		// "tell the wall" runs commands, and still adds everything else
		const say = (t) => text('POST', '/api/tasks/say', t, { 'Content-Type': 'text/plain' });
		assert.equal(await say("I'm done with the bins"), 'Done: Take out the bins. Nothing else waiting.');
		taskHub.create({ title: 'Change the sheets', at: at(11) + '', repeat: 'weekly' });
		taskHub.done(taskHub.snapshot().find((t) => t.title === 'Change the sheets').id);
		assert.equal(await say('done with the sheets'), "Change the sheets isn't due until October 16 at 11 AM. Nothing to tick off yet.", 'never skips ahead');
		assert.equal(await say('show me the weather'), 'Showing the weather.');
		assert.equal(view, 'weather');
		assert.equal(await say('done with the dentist'), 'I couldn’t find "the dentist" on the wall.'.replace('’', "'"));
		assert.match(await say('water the plants tomorrow at 8am'), /^Added a chore: Water the plants, tomorrow at 8 AM\.$/);
		assert.equal(await say('goodnight'), 'Screen off. Good night.');
		assert.equal(calls.at(-1), 'screen:off');

		// approvals: a press only reads it out; the menu or a command answers
		approvalHub.request({ source: 'Claude Code', tool: 'Bash', detail: 'git push' });
		assert.match(await text('POST', '/api/action'), /^Claude Code is waiting: Run Bash\? git push\. Hold the button/);
		assert.equal(approvalHub.snapshot().length, 1, 'still pending after a press');
		assert.equal(await text('POST', '/api/action/run', 'Allow: git push', { 'Content-Type': 'text/plain' }), 'Allowed: git push.');
		assert.equal(approvalHub.snapshot().length, 0);

		// token
		writeFileSync(path.join(dataDir, 'api-token'), 'k');
		assert.equal(await text('POST', '/api/action'), 'The wall wants a token. Check the shortcut header.');
		assert.match(await text('POST', '/api/action', undefined, { Authorization: 'Bearer k' }), /\S/);
	} finally {
		approvalHub.stop();
		await new Promise((r) => server.close(r));
	}
});
