import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskHub } from '../src/lib/server/taskHub.js';
import { createApprovalHub } from '../src/lib/server/approvalHub.js';
import { createActionHub } from '../src/lib/server/actionHub.js';
import { HELP_SAY, matchTask, normalizeCommand, parseCommand, resolveTask, sameWord, understand, volumeTarget, speakVolume, speakNowPlaying } from '../src/lib/wallActions.js';

test('dictation noise is stripped before matching', () => {
	assert.equal(normalizeCommand('Hey wall, could you please pause the music for me?'), 'pause the music');
	assert.equal(normalizeCommand('tell the wall to show the weather'), 'show the weather');
	assert.equal(normalizeCommand('what’s on the wall'), "what's on the wall", 'curly apostrophes from Siri');
	assert.equal(normalizeCommand('show me the whether'), 'show me the weather');
	assert.equal(normalizeCommand('open the calender'), 'open the calendar');
	assert.equal(normalizeCommand('skip this song now'), 'skip this song');
	assert.equal(normalizeCommand('whether or not it rains'), 'whether or not it rains', 'a real "whether" stays');
});

test('phrasings people actually say', () => {
	const intent = (t) => parseCommand(t)?.intent ?? null;
	const cases = {
		'what’s on the wall?': 'brief',
		'Hey wall, what is the weather like': 'weather',
		'could you please show me the forecast': 'show',
		'bring up the radar': 'show',
		'take me to the calendar': 'show',
		'switch to the agent view': 'show',
		'pull up the calender': 'show',
		"what's the time": 'time',
		'what time is it': 'time',
		'what day is it today': 'date',
		"what's the date": 'date',
		"what's this song": 'now-playing',
		'who is singing': 'now-playing',
		'what am I listening to': 'now-playing',
		'help': 'help',
		'what can you do': 'help',
		'say that again': 'repeat',
		'repeat that': 'repeat',
		'I just finished the dishes': 'done',
		'the laundry was all done': 'done',
		'mark the bins complete': 'done',
		'turn it up': 'volume',
		'volume down': 'volume',
		'make it quieter': 'volume',
		'mute': 'volume',
		'unmute': 'volume',
		'continue the music': 'music',
		'resume': 'music',
		'skip': 'music'
	};
	for (const [text, want] of Object.entries(cases)) assert.equal(intent(text), want, text);
});

test('volume commands', () => {
	assert.deepEqual(parseCommand('turn it up'), { intent: 'volume', change: 'up' });
	assert.deepEqual(parseCommand('turn the volume up a lot'), { intent: 'volume', change: 'up', big: true });
	assert.deepEqual(parseCommand('lower the volume'), { intent: 'volume', change: 'down' });
	assert.deepEqual(parseCommand('set the volume to 40 percent'), { intent: 'volume', change: 'set', level: 40 });
	assert.deepEqual(parseCommand('volume forty'), { intent: 'volume', change: 'set', level: 40 }, 'spelled numbers');
	assert.deepEqual(parseCommand('set volume to 250'), { intent: 'volume', change: 'set', level: 100 }, 'capped at 100');
	assert.deepEqual(parseCommand('mute'), { intent: 'volume', change: 'mute' });

	assert.deepEqual(volumeTarget({ volume: 0.5 }, { change: 'up' }), { volume: 0.6 });
	assert.deepEqual(volumeTarget({ volume: 0.5 }, { change: 'down', big: true }), { volume: 0.25 });
	assert.deepEqual(volumeTarget({ volume: 0.95 }, { change: 'up' }), { volume: 1 }, 'a voice command never passes 100%');
	assert.deepEqual(volumeTarget({ volume: 1.4 }, { change: 'up' }), { volume: 1 });
	assert.deepEqual(volumeTarget({ volume: 0.05 }, { change: 'down' }), { volume: 0 });
	assert.deepEqual(volumeTarget({}, { change: 'set', level: 30 }), { volume: 0.3 });
	assert.deepEqual(volumeTarget({ volume: 0.4 }, { change: 'mute' }), { muted: true });
	assert.equal(speakVolume({ volume: 0.6 }), 'Volume 60 percent.');
	assert.equal(speakVolume({ muted: true }), 'Muted.');
});

test('numbers said as words: snooze for two hours', () => {
	assert.deepEqual(parseCommand('snooze the cat for two hours'), { intent: 'snooze', query: 'the cat', minutes: 120 });
	assert.deepEqual(parseCommand('snooze for thirty minutes'), { intent: 'snooze', query: '', minutes: 30 });
});

test('sentences that are chores or reminders stay chores and reminders', () => {
	for (const add of [
		'remind me to turn the volume up at 6',
		'mute the tv every night at 9',
		'repeat the lesson tomorrow',
		'help mom with the groceries on Friday',
		'what to cook tonight',
		'time to buy milk',
		'date night on Saturday',
		'finish the report by 5pm',
		'play guitar every evening',
		'skip rope at 4'
	]) {
		assert.equal(parseCommand(add), null, add);
	}
});

test('dictation slips still find the right chore', () => {
	const views = [
		{ id: 'a', title: 'Vacuum the living room', status: 'today' },
		{ id: 'b', title: 'Do the laundry', status: 'upcoming' },
		{ id: 'c', title: 'Ring the dentist', status: 'upcoming' },
		{ id: 'd', title: 'Buy bikes', status: 'upcoming' }
	];
	assert.equal(matchTask(views, 'vaccum')?.id, 'a', 'one slipped letter');
	assert.equal(matchTask(views, 'the laundary')?.id, 'b');
	assert.equal(matchTask(views, 'vacuuming the room')?.id, 'a', '"-ing" forms');
	assert.equal(matchTask(views, 'bike')?.id, 'd', 'bike / bikes');
	assert.equal(matchTask(views, 'ring')?.id, 'c', '"ring" is not cut down to "r"');
	assert.equal(matchTask(views, 'bring the pizza'), null, 'unrelated');
	assert.equal(sameWord('cat', 'cut'), false, 'short words must match exactly');
});

test('ties are asked about, not guessed', () => {
	const views = [
		{ id: 'a', title: 'Feed the cat', status: 'due' },
		{ id: 'b', title: 'Feed the fish', status: 'due' },
		{ id: 'c', title: 'Feed the dog', status: 'upcoming' }
	];
	assert.deepEqual(resolveTask(views, 'feed'), { task: null, ambiguous: ['Feed the cat', 'Feed the fish'] }, 'both due: ask; the upcoming one is out');
	assert.equal(resolveTask(views, 'feed the cat').task.id, 'a');
	assert.equal(resolveTask(views, 'feed the dog').task.id, 'c');
	assert.equal(resolveTask(views, 'dentist').task, null);
	// one due and one not: the due one wins without asking
	assert.equal(resolveTask([views[0], views[2]], 'feed').task.id, 'a');
});

test('understand: a dry run', () => {
	assert.deepEqual(understand('Hey wall, pause the music please'), { text: 'Hey wall, pause the music please', normalized: 'pause the music', command: { intent: 'music', action: 'pause' }, would: 'run' });
	assert.equal(understand('water the plants friday').would, 'add');
	assert.equal(understand('   ').would, 'nothing');
});

test('answers', () => {
	assert.equal(speakNowPlaying({ playing: true, title: 'Kyoto', artist: 'Phoebe Bridgers' }), 'Kyoto by Phoebe Bridgers.');
	assert.equal(speakNowPlaying({ playing: false, title: 'Kyoto', artist: 'Unknown artist' }), 'Paused: Kyoto.');
	assert.equal(speakNowPlaying(null), 'Nothing is playing.');
	assert.match(HELP_SAY, /weather/);
});

test('HTTP: volume, time, now playing, repeat, ties and the dry run', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'vc-'));
	const quiet = { log() {}, warn() {}, error() {} };
	const now = Date.UTC(2026, 9, 9, 11, 20); // 7:20 AM on the wall's clock (New York)
	const broadcast = () => {};
	let actionHub;
	const taskHub = createTaskHub({ dataDir, broadcast, log: quiet, now: () => now, env: {}, commands: (t) => actionHub.command(t) });
	const approvalHub = createApprovalHub({ dataDir, broadcast, log: quiet, now: () => now, env: {} });
	const sink = { volume: 0.5, muted: false };
	const applied = [];
	actionHub = createActionHub({
		dataDir,
		taskHub,
		approvalHub,
		broadcast,
		now: () => now,
		env: {},
		log: quiet,
		getState: () => ({ nowPlaying: { playing: true, title: 'Kyoto', artist: 'Phoebe Bridgers' }, view: 'clock', hdmi: 'on' }),
		volume: {
			get: async () => ({ ok: true, ...sink }),
			apply: async (t) => {
				applied.push(t);
				if (t.muted !== undefined) sink.muted = t.muted;
				else {
					sink.volume = t.volume;
					sink.muted = false;
				}
				return { ok: true, ...sink };
			}
		}
	});
	const server = createServer(async (req, res) => {
		if (await taskHub.handleHttp(req, res)) return;
		if (await actionHub.handleHttp(req, res)) return;
		res.writeHead(404);
		res.end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const say = async (t) => (await fetch(`${base}/api/tasks/say?format=text`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: t })).text();
	try {
		assert.equal(await say('Hey wall, turn it up'), 'Volume 60 percent.');
		assert.equal(await say('volume down a lot'), 'Volume 35 percent.');
		assert.equal(await say('set the volume to thirty'), 'Volume 30 percent.');
		assert.equal(await say('mute'), 'Muted.');
		assert.equal(await say('unmute'), 'Unmuted.');
		assert.deepEqual(applied, [{ volume: 0.6 }, { volume: 0.35 }, { volume: 0.3 }, { muted: true }, { muted: false }]);

		assert.equal(await say('what time is it'), "It's 7:20 AM.");
		assert.equal(await say('what day is it'), "It's Friday, October 9.");
		assert.equal(await say("what's this song"), 'Kyoto by Phoebe Bridgers.');
		assert.match(await say('help'), /^Try: /);
		assert.equal(await say('say that again'), 'Try: ' + (await say('help')).slice(5), 'repeats the last answer');

		taskHub.create({ title: 'Feed the cat', at: new Date(2026, 9, 9, 7).toISOString() });
		taskHub.create({ title: 'Feed the fish', at: new Date(2026, 9, 9, 7).toISOString() });
		assert.equal(await say('done with feed'), 'Which one: Feed the cat or Feed the fish? Say a bit more.');
		assert.equal(taskHub.snapshot().filter((t) => t.status === 'done').length, 0, 'nothing was ticked off');
		assert.match(await say('done with the fish'), /^Done: Feed the fish\./);
		assert.match(await say("I'm finished with the cat"), /^Done: Feed the cat\./);

		const dry = await (await fetch(`${base}/api/action/parse?text=${encodeURIComponent('Hey wall, pause the music please')}`)).json();
		assert.equal(dry.normalized, 'pause the music');
		assert.deepEqual(dry.command, { intent: 'music', action: 'pause' });
		assert.equal(dry.would, 'run');
		const add = await (await fetch(`${base}/api/action/parse`, { method: 'POST', body: JSON.stringify({ text: 'water the plants friday' }) })).json();
		assert.equal(add.would, 'add');
		assert.equal(taskHub.snapshot().some((t) => /plants/i.test(t.title)), false, 'a dry run adds nothing');
	} finally {
		server.close();
		approvalHub.stop();
		taskHub.stop?.();
	}
});
