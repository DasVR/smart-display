// The wall reads days on its own clock (America/New_York), like the kiosk.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanSpeech, parseQuick, parseTimer, speakDuration, speakTimerSet } from '../src/lib/quickSay.js';
import { parseCommand, speakTimersLeft, speakTomorrow, speakWeather } from '../src/lib/wallActions.js';
import { listAddresses } from '../src/lib/addresses.js';
import { textDelivery, deliverWebhooks } from '../src/lib/server/taskService.js';
import { createTaskHub } from '../src/lib/server/taskHub.js';
import { createApprovalHub } from '../src/lib/server/approvalHub.js';
import { createActionHub } from '../src/lib/server/actionHub.js';

const quiet = { log() {}, warn() {}, error() {} };
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(10, 7, 20); // Saturday 10 Oct, 7:20 AM

test('dictation is tidied before anything reads it', () => {
	assert.equal(cleanSpeech('Um, can you please set a reminder to call mom, thanks.'), 'remind me to call mom');
	assert.equal(cleanSpeech("hey siri, don't let me forget the dentist"), 'remind me to the dentist');
	assert.equal(cleanSpeech('make sure I lock the door'), 'remind me to lock the door');
	assert.equal(cleanSpeech('reminder about the bins at 6'), 'remind me to the bins at 6');
	assert.equal(cleanSpeech('just snooze it'), 'snooze it');
	assert.equal(cleanSpeech('Take out the bins.'), 'Take out the bins');

	const r = parseQuick('um can you set a reminder to call mom at five thirty', NOW);
	assert.equal(r.task.kind, 'alert');
	assert.equal(r.task.title, 'Call mom');
	assert.equal(new Date(r.task.at).getHours(), 17);
	assert.equal(new Date(r.task.at).getMinutes(), 30);
});

test('timers', () => {
	const t = parseTimer('set a timer for ten minutes', NOW);
	assert.equal(Date.parse(t.task.at) - NOW, 600000);
	assert.equal(t.task.kind, 'alert');
	assert.equal(speakTimerSet(t.timer), 'Timer set for 10 minutes.');
	assert.equal(speakTimerSet(parseTimer('pasta timer 12 minutes', NOW).timer), 'Pasta timer set for 12 minutes.');
	assert.equal(parseTimer('a 20 minute timer called laundry', NOW).task.title, 'Timer: Laundry');
	assert.equal(speakTimerSet(parseTimer('timer for 1 hour and 5 minutes', NOW).timer), 'Timer set for 1 hour 5 minutes.');
	assert.equal(speakTimerSet(parseTimer('90 second timer', NOW).timer), 'Timer set for 90 seconds.');
	assert.equal(speakTimerSet(parseTimer('timer for half an hour', NOW).timer), 'Timer set for 30 minutes.');
	assert.equal(parseTimer('set a timer', NOW).code, 'no-duration');
	assert.equal(parseTimer('set a timer for 1 second', NOW).code, 'bad-duration');
	assert.equal(parseTimer('remind me to take the timer out in 5 minutes', NOW), null, 'a reminder that mentions a timer');
	assert.equal(speakDuration(125000), '2 minutes 5 seconds'.replace(' 5 seconds', ''), 'rounds to whole minutes past two');
	assert.equal(speakDuration(3900000), '1 hour 5 minutes');
});

test('new spoken commands', () => {
	assert.deepEqual(parseCommand('undo that'), { intent: 'undo' });
	assert.deepEqual(parseCommand('scratch that'), { intent: 'undo' });
	assert.deepEqual(parseCommand('cancel the timer'), { intent: 'cancel-timer' });
	assert.deepEqual(parseCommand('how long is left on the pasta timer'), { intent: 'timer-left' });
	assert.deepEqual(parseCommand("what's the weather"), { intent: 'weather' });
	assert.deepEqual(parseCommand('do I need an umbrella'), { intent: 'weather' });
	assert.deepEqual(parseCommand('what do I have tomorrow'), { intent: 'tomorrow' });
	assert.deepEqual(parseCommand('what do I have'), { intent: 'brief' }, 'today stays the brief');
	assert.equal(parseCommand('um could you please show me the radar').view, 'weather');
	assert.equal(parseCommand('set a timer for 5 minutes'), null, 'a timer is added, not a command');
});

test('weather, tomorrow and timers out loud', () => {
	const hourly = [];
	for (let h = 6; h < 22; h++) hourly.push({ time: `2026-10-10T${String(h).padStart(2, '0')}:00`, temp: 58 + h / 2, precipitation_probability: h === 15 ? 70 : 5 });
	const wx = { current: { temp: 61.4, desc: 'Partly cloudy' }, hourly, prediction: {}, alerts: [] };
	assert.equal(speakWeather(wx, NOW), "It's 61 degrees and partly cloudy. High of 69 today. Rain likely around 3 PM.");
	assert.equal(speakWeather({ current: { temp: 70, desc: 'Clear' }, hourly: [], prediction: { rain30min: 0.6 } }, NOW), "It's 70 degrees and clear. Rain is on the radar right now.");
	assert.equal(speakWeather(null, NOW), "I couldn't get the weather right now.");

	const iso = (d, h, m = 0) => new Date(at(d, h, m)).toISOString();
	const tasks = [
		{ title: 'Leave for school', kind: 'alert', status: 'upcoming', nextDue: iso(11, 7, 40) },
		{ title: 'Dentist', kind: 'chore', status: 'upcoming', nextDue: iso(11, 15) },
		{ title: 'Physics lab report', kind: 'homework', status: 'upcoming', allDay: true, nextDue: new Date(2026, 9, 11, 23, 59).toISOString() },
		{ title: 'Bins', kind: 'chore', status: 'today', nextDue: iso(10, 18) }
	];
	assert.equal(speakTomorrow(tasks, NOW), 'Tomorrow: Leave for school at 7:40 AM, Dentist at 3 PM and Physics lab report due.');
	assert.equal(speakTomorrow([], NOW), 'Nothing on for tomorrow.');

	const timers = [{ title: 'Timer: Pasta', kind: 'alert', status: 'upcoming', nextDue: new Date(NOW + 380000).toISOString() }];
	assert.equal(speakTimersLeft(timers, NOW), 'Pasta: 6 minutes 20 seconds left.'.replace(' 20 seconds', ''));
	assert.equal(speakTimersLeft([], NOW), 'No timers running.');
});

test('addresses the phone can use, home and Tailscale', () => {
	const ifaces = {
		lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
		eth0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
		tailscale0: [{ family: 'IPv4', address: '100.104.181.43', internal: false }],
		docker0: [{ family: 'IPv4', address: '172.17.0.1', internal: false }]
	};
	assert.deepEqual(listAddresses(ifaces, 3000, 'kiosk'), [
		{ label: 'Home Wi-Fi', host: '192.168.1.20:3000' },
		{ label: 'Tailscale', host: '100.104.181.43:3000' },
		{ label: 'Name', host: 'kiosk.local:3000' }
	]);
	assert.deepEqual(listAddresses({}, 3000, 'my host'), [], 'a hostname with spaces is not an address');
});

test('phone notifications: a webhook can send plain text, ntfy style', async () => {
	const d = textDelivery('task.due', { task: { title: 'Take meds', kind: 'alert', notes: 'With food' } });
	assert.equal(d.body, 'Due now: Take meds\nWith food');
	assert.deepEqual(d.headers, { Title: 'Alert', Priority: '4', Tags: 'bell' });
	assert.equal(textDelivery('task.done', { task: { title: 'Bins' } }).headers.Tags, 'white_check_mark');

	const sent = [];
	const hooks = [
		{ id: 'a', url: 'https://ntfy.sh/mytopic', events: ['task.due'], format: 'text', secret: '' },
		{ id: 'b', url: 'https://example.com/hook', events: ['task.due'], format: 'json', secret: 's' }
	];
	await deliverWebhooks(hooks, 'task.due', { task: { title: 'Bins', kind: 'chore' } }, { fetchImpl: async (url, init) => (sent.push({ url, init }), { ok: true, status: 200 }), log: quiet });
	assert.equal(sent[0].init.headers['Content-Type'], 'text/plain; charset=utf-8');
	assert.equal(sent[0].init.body, 'Due now: Bins');
	assert.equal(sent[0].init.headers.Priority, '3');
	assert.match(sent[1].init.headers['X-Display-Signature'], /^sha256=/);
	assert.equal(JSON.parse(sent[1].init.body).event, 'task.due');
});

async function harness({ weather = async () => null, events = async () => [] } = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'hands-'));
	const nowRef = { t: NOW };
	const sent = [];
	const calls = [];
	const broadcast = (m) => sent.push(m);
	let actionHub;
	const taskHub = createTaskHub({ dataDir, broadcast, log: quiet, now: () => nowRef.t, env: {}, commands: (t) => actionHub.command(t) });
	const approvalHub = createApprovalHub({ dataDir, broadcast, log: quiet, now: () => nowRef.t, env: {} });
	actionHub = createActionHub({
		dataDir,
		taskHub,
		approvalHub,
		broadcast,
		now: () => nowRef.t,
		env: {},
		log: quiet,
		getState: () => ({ nowPlaying: null, view: 'clock', hdmi: 'on' }),
		navigate: (v) => calls.push(`view:${v}`),
		player: async () => ({ ok: true }),
		screen: async (s) => calls.push(`screen:${s}`),
		loadWeather: weather,
		loadEvents: events
	});
	const server = createServer(async (req, res) => {
		if (await taskHub.handleHttp(req, res)) return;
		if (await actionHub.handleHttp(req, res)) return;
		res.writeHead(404);
		res.end();
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const text = async (method, p, body) => (await fetch(`${base}${p}${p.includes('?') ? '&' : '?'}format=text`, { method, body, headers: { 'Content-Type': 'text/plain' } })).text();
	const say = (t) => text('POST', '/api/tasks/say', t);
	return { taskHub, approvalHub, actionHub, nowRef, sent, calls, text, say, close: () => (approvalHub.stop(), new Promise((r) => server.close(r))) };
}

test('undo takes back the last add, tick-off or snooze', async () => {
	const h = await harness();
	try {
		assert.match(await h.say('remind me to stretch in 10 minutes'), /^Reminder set: Stretch/);
		assert.equal(await h.say('undo that'), 'Undone. Removed Stretch.');
		assert.equal(h.taskHub.snapshot().length, 0);
		assert.equal(await h.say('undo'), 'Nothing to undo.');

		h.taskHub.create({ title: 'Feed the cat', at: new Date(at(10, 7)).toISOString(), repeat: 'daily' });
		const before = h.taskHub.snapshot()[0];
		assert.equal(before.status, 'overdue');
		assert.match(await h.say("I'm done with the cat"), /^Done: Feed the cat/);
		assert.equal(h.taskHub.snapshot()[0].status, 'upcoming', 'moved to tomorrow');
		assert.match(await h.text('GET', '/api/action/menu'), /Undo: Done Feed the cat/);
		assert.equal(await h.say('oops'), 'Undone. Feed the cat is back on the list.');
		assert.equal(h.taskHub.snapshot()[0].status, 'overdue');
		assert.equal(h.taskHub.snapshot()[0].doneCount ?? 0, 0);

		assert.match(await h.say('snooze the cat for an hour'), /^Snoozed Feed the cat/);
		assert.equal(await h.say('undo that'), 'Undone. Feed the cat is back.');
		assert.equal(h.taskHub.snapshot()[0].status, 'overdue');

		// entries expire after 10 minutes
		await h.say('remind me to stretch in 10 minutes');
		h.nowRef.t += 11 * 60000;
		assert.equal(await h.say('undo that'), 'Nothing to undo.');
	} finally {
		await h.close();
	}
});

test('the same request twice does not add twice', async () => {
	const h = await harness();
	try {
		assert.match(await h.say('take out the bins tomorrow at 6pm'), /^Added a chore: Take out the bins/);
		assert.equal(await h.say('take out the bins tomorrow at 6pm'), 'Already on the list: Take out the bins.');
		assert.equal(h.taskHub.snapshot().length, 1);
		// minutes later it is a new request
		h.nowRef.t += 3 * 60000;
		assert.match(await h.say('take out the bins tomorrow at 6pm'), /^Added a chore/);
		assert.equal(h.taskHub.snapshot().length, 2);

		assert.equal(await h.say('set a timer for ten minutes'), 'Timer set for 10 minutes.');
		assert.equal(await h.say('set a timer for ten minutes'), 'That timer is already running.');
	} finally {
		await h.close();
	}
});

test('timers: set, ask, cancel', async () => {
	const h = await harness();
	try {
		assert.equal(await h.say('um set a pasta timer for twelve minutes'), 'Pasta timer set for 12 minutes.');
		h.nowRef.t += 60000;
		assert.equal(await h.say('how long is left on the timer'), 'Pasta: 11 minutes left.');
		assert.equal(await h.say('cancel the timer'), 'Timer cancelled.');
		assert.equal(await h.say('cancel the timer'), 'No timers running.');
		assert.equal(await h.say('timer'), 'No timers running.');
		assert.equal(await h.say('set a timer'), 'How long should the timer be?');
	} finally {
		await h.close();
	}
});

test('hands-off automations: morning, night, home, leaving', async () => {
	const weather = async () => ({
		current: { temp: 58, desc: 'Clear' },
		hourly: [{ time: '2026-10-10T15:00', temp: 72, precipitation_probability: 10 }],
		prediction: {}
	});
	const h = await harness({ weather });
	try {
		h.taskHub.create({ title: 'Feed the cat', at: new Date(at(10, 7)).toISOString() });
		h.taskHub.create({ title: 'Dentist', at: new Date(at(11, 15)).toISOString() });
		assert.equal(
			await h.text('GET', '/api/action/event/morning'),
			"Good morning. It's 58 degrees and clear. High of 72 today. No rain expected. One thing waiting: Feed the cat. Next up: Dentist, tomorrow at 3 PM."
		);
		assert.deepEqual(h.calls, ['screen:on', 'view:clock']);

		h.calls.length = 0;
		assert.equal(await h.text('POST', '/api/action/event/night'), 'Tomorrow: Dentist at 3 PM. Good night.');
		assert.deepEqual(h.calls, ['screen:off']);

		h.calls.length = 0;
		assert.match(await h.text('GET', '/api/action/event/home'), /^Welcome home\. One thing waiting: Feed the cat/);
		assert.equal(await h.text('GET', '/api/action/event/leaving'), 'Nothing on the board. 1 thing is still waiting.');
		assert.match(await h.text('GET', '/api/action/event/dinner'), /don't know the dinner automation/);
	} finally {
		await h.close();
	}
});

test('a slow weather lookup never holds up an answer', async () => {
	const never = () => new Promise(() => {});
	const h = await harness({ weather: never, events: never });
	try {
		const t0 = Date.now();
		const out = await h.say("what's the weather");
		assert.equal(out, "I couldn't get the weather right now.");
		assert.ok(Date.now() - t0 < 4500, `answered in ${Date.now() - t0} ms`);
	} finally {
		await h.close();
	}
});
