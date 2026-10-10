import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseQuick, speakAdded, speakBrief, speakWhen, pickNext } from '../src/lib/quickSay.js';
import { createTaskHub } from '../src/lib/server/taskHub.js';

// Local-time helpers so the suite passes in any TZ. Friday 9 Oct 2026, 10:00.
const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 9, 10);
const local = (s) => {
	const d = new Date(s);
	return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
};
const parse = (text, now = NOW) => {
	const r = parseQuick(text, now);
	assert.equal(r.error, undefined, `${text}: ${r.error}`);
	return r.task;
};

test('reminders become alerts, everything else a chore', () => {
	const a = parse('remind me to leave for practice in 20 minutes');
	assert.equal(a.kind, 'alert');
	assert.equal(a.title, 'Leave for practice');
	assert.deepEqual(local(a.at), [10, 9, 10, 20]);

	const c = parse('Hey Siri, add a chore to clean my room tonight');
	assert.equal(c.kind, 'chore');
	assert.equal(c.title, 'Clean my room');
	assert.deepEqual(local(c.at), [10, 9, 20, 0]);

	assert.equal(parse('Stop by the store').title, 'Stop by the store', '"by" inside a title survives');
});

test('days, times and parts of the day', () => {
	assert.deepEqual(local(parse('call the dentist tomorrow').at), [10, 10, 9, 0], 'a day with no time is 9 AM');
	assert.deepEqual(local(parse('take meds at noon').at), [10, 9, 12, 0]);
	assert.deepEqual(local(parse('start dinner at 5').at), [10, 9, 17, 0], 'a bare 5 reads as 5 PM');
	assert.deepEqual(local(parse('feed the fish at 9:15').at), [10, 10, 9, 15], 'past today, so tomorrow');
	assert.deepEqual(local(parse('dentist oct 12 at 3:30 pm').at), [10, 12, 15, 30]);
	assert.deepEqual(local(parse('laundry this evening').at), [10, 9, 18, 0]);
	assert.deepEqual(local(parse('water the plants on saturday').at), [10, 10, 9, 0]);
	assert.deepEqual(local(parse('pick up Sam friday at 9am').at), [10, 16, 9, 0], "today's slot already passed: next week");
	assert.deepEqual(local(parse('pick up Sam friday at 5pm').at), [10, 9, 17, 0]);
});

test('repeats', () => {
	const bins = parse('take out the bins every monday and thursday at 6pm');
	assert.deepEqual(bins.repeat, { freq: 'weekly', interval: 1, days: [1, 4] });
	assert.deepEqual(local(bins.at), [10, 12, 18, 0], 'first one is the next Monday');
	assert.equal(bins.title, 'Take out the bins');

	assert.deepEqual(parse('meds every day at 8:30am').repeat, { freq: 'daily', interval: 1 });
	assert.deepEqual(parse('vacuum every other week').repeat, { freq: 'weekly', interval: 2 });
	assert.deepEqual(parse('trash every weekday at 7am').repeat.days, [1, 2, 3, 4, 5]);
	const rent = parse('pay rent on the 1st every month');
	assert.equal(rent.repeat.freq, 'monthly');
	assert.deepEqual(local(rent.at), [11, 1, 9, 0]);
	assert.equal(parse('feed the cat daily at 7').repeat.freq, 'daily');
});

test('says what it could not place, in words Siri can read', () => {
	assert.match(parseQuick('remind me to call mom', NOW).error, /When should I remind you to call mom\?/);
	assert.match(parseQuick('', NOW).error, /didn't hear/);
	assert.match(parseQuick('tomorrow at 6pm', NOW).error, /what to add/);
});

test('speaking tasks back', () => {
	assert.equal(speakWhen(new Date(NOW + 20 * 60000).toISOString(), NOW), 'in 20 minutes');
	assert.equal(speakWhen(new Date(at(2026, 10, 10, 18, 30)).toISOString(), NOW), 'tomorrow at 6:30 PM');
	assert.equal(speakWhen(new Date(at(2026, 10, 12, 12)).toISOString(), NOW), 'Monday at noon');
	const bins = parse('take out the bins every monday and thursday at 6pm');
	assert.equal(speakAdded({ ...bins, nextDue: bins.at }, NOW), 'Added a chore: Take out the bins, Monday at 6 PM, every Monday and Thursday.');

	const views = [
		{ title: 'Bins', status: 'overdue', nextDue: new Date(NOW - 3600000).toISOString() },
		{ title: 'Feed the cat', status: 'overdue', nextDue: new Date(NOW - 60000).toISOString() },
		{ title: 'Meds', status: 'today', nextDue: new Date(at(2026, 10, 9, 20)).toISOString() }
	];
	assert.equal(speakBrief(views, NOW), '2 things waiting: Bins and Feed the cat. Later today: Meds at 8 PM.');
	assert.equal(speakBrief([], NOW), 'Nothing waiting.');
	assert.equal(pickNext(views).title, 'Bins');
	assert.equal(pickNext([views[2]]).title, 'Meds', 'falls back to later today');
	assert.equal(pickNext([]), null);
});

test('Siri routes: say, brief, next/done, plain-text answers, token', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'say-'));
	const nowRef = { t: NOW };
	const hub = createTaskHub({ dataDir, broadcast: () => {}, log: { log() {}, warn() {}, error() {} }, now: () => nowRef.t, env: {} });
	const server = createServer(async (req, res) => {
		if (!(await hub.handleHttp(req, res))) (res.writeHead(404), res.end());
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		// JSON in, JSON out
		let res = await fetch(`${base}/api/tasks/say`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: 'feed the cat at 9am every day' })
		});
		assert.equal(res.status, 201);
		let body = await res.json();
		assert.equal(body.task.source, 'Siri');
		assert.match(body.say, /^Added a chore: Feed the cat, tomorrow at 9 AM, every day\.$/);

		// dictated text straight in, sentence straight out
		res = await fetch(`${base}/api/tasks/say?format=text`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: 'take out the bins in 5 minutes'
		});
		assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
		assert.equal(await res.text(), 'Added a chore: Take out the bins, in 5 minutes.');

		res = await fetch(`${base}/api/tasks/say?format=text`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'remind me to call mom' });
		assert.equal(res.status, 200, 'text answers stay 200 so Shortcuts reaches Speak Text');
		assert.equal(await res.text(), 'When should I remind you to call mom?');

		nowRef.t = NOW + 10 * 60000;
		res = await fetch(`${base}/api/tasks/brief`, { headers: { Accept: 'text/plain' } });
		assert.equal(await res.text(), 'One thing waiting: Take out the bins. Next up: Feed the cat, tomorrow at 9 AM.');

		res = await fetch(`${base}/api/tasks/next/done?format=text`, { method: 'POST' });
		assert.equal(await res.text(), 'Done: Take out the bins. Nothing else waiting.');
		res = await fetch(`${base}/api/tasks/next/done`, { method: 'POST' });
		assert.equal((await res.json()).say, 'Nothing waiting. All clear.');

		// the token guards these too
		writeFileSync(path.join(dataDir, 'api-token'), 'sekrit');
		assert.equal((await fetch(`${base}/api/tasks/brief`)).status, 401);
		res = await fetch(`${base}/api/tasks/brief`, { headers: { Authorization: 'Bearer sekrit' } });
		assert.equal(res.status, 200);
	} finally {
		await new Promise((r) => server.close(r));
	}
});

test('spelled-out numbers, the way Siri sometimes writes them', () => {
	const a = parse('remind me to go downstairs in two minutes');
	assert.equal(a.kind, 'alert');
	assert.equal(a.title, 'Go downstairs');
	assert.deepEqual(local(a.at), [10, 9, 10, 2]);
	assert.deepEqual(local(parse('stretch in twenty-five minutes').at), [10, 9, 10, 25]);
	assert.deepEqual(local(parse('check the oven in a couple of hours').at), [10, 9, 12, 0]);
	assert.deepEqual(local(parse('start dinner at five thirty pm').at), [10, 9, 17, 30]);
	assert.deepEqual(local(parse('call mom at six').at), [10, 9, 18, 0]);
	assert.deepEqual(local(parse("meds at seven o'clock").at), [10, 10, 7, 0]);
	assert.equal(parse('take one pill').title, 'Take one pill', 'numbers in the title stay words');
});

test('a question back is answered by the next sentence', async () => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'ask-'));
	const nowRef = { t: NOW };
	const hub = createTaskHub({ dataDir, broadcast: () => {}, log: { log() {}, warn() {}, error() {} }, now: () => nowRef.t, env: {} });
	const say = async (text) => (await hub.sayAdd({ text })).data;

	assert.equal((await say('remind me to call mom')).say, 'When should I remind you to call mom?');
	const done = await say('at five');
	assert.equal(done.say, 'Reminder set: Call mom, today at 5 PM.');
	assert.equal(done.task.kind, 'alert');

	assert.equal((await say('remind me to feed the fish')).asking, true);
	assert.equal((await say('never mind')).say, 'Okay, never mind.');
	assert.equal(hub.snapshot().filter((t) => t.title === 'Feed the fish').length, 0);

	// the question expires; a bare time afterwards isn't glued to it
	await say('remind me to water plants');
	nowRef.t += 3 * 60000;
	assert.match((await say('in ten minutes')).say, /what to add/);

	// a new full sentence replaces the pending question
	await say('remind me to stretch');
	assert.match((await say('take out the bins at 6pm')).say, /^Added a chore: Take out the bins/);
	assert.match((await say('in two minutes')).say, /what to add/, 'the old question was dropped');
});
