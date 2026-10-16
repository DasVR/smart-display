import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asksBack, spokenAnswer, systemPrompt, TOOLS } from '../src/lib/assistant.js';
import { createAssistantHub, searchDigest } from '../src/lib/server/assistantHub.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
const call = (name, args) => ({ function: { name, arguments: args } });

function fakeOllama(script) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		const body = JSON.parse(init.body);
		calls.push({ url, body, auth: init.headers.Authorization });
		const step = script.shift();
		if (!step) throw new Error('unexpected call ' + url);
		if (step.status) return { ok: false, status: step.status, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => step };
	};
	return { fetchImpl, calls };
}

function hub(script, { env = { OLLAMA_API_KEY: 'k123' }, actions = {}, dataDir = tmp() } = {}) {
	const fake = fakeOllama(script);
	const h = createAssistantHub({ dataDir, fetchImpl: fake.fetchImpl, env, actions, log: { warn() {} } });
	return { h, calls: fake.calls };
}

test('spokenAnswer strips markdown, links and citations and keeps it short', () => {
	assert.equal(spokenAnswer('**The moon** is about [384,400 km](https://x.y) away.【1†source】'), 'The moon is about 384,400 km away.');
	assert.equal(spokenAnswer('- one\n- two'), 'one two');
	const long = 'This is a sentence that goes on for a while. '.repeat(20);
	assert.ok(spokenAnswer(long).length <= 320);
	assert.match(spokenAnswer(long), /\.$/);
});

test('systemPrompt is short, casual, and carries the date', () => {
	const p = systemPrompt({ now: Date.UTC(2026, 9, 16, 15), timeZone: 'America/New_York', place: 'Largo, Florida' });
	assert.match(p, /October 16, 2026/);
	assert.match(p, /Largo, Florida/);
	assert.match(p, /casual/);
	assert.ok(p.length < 700);
});

test('asksBack notices a question at the end', () => {
	assert.equal(asksBack('Which one, the cat or the fish?'), true);
	assert.equal(asksBack('Done.'), false);
});

test('searchDigest keeps three trimmed results', () => {
	const rows = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, content: 'x'.repeat(1000) }));
	assert.equal(searchDigest(rows).split('\n').length, 3);
	assert.equal(searchDigest([]), 'No results.');
});

test('converse: plain chat is answered with no tools run', async () => {
	const { h, calls } = hub([{ message: { content: "Ha, I'm doing great. How about you?" } }], { actions: { command: async () => assert.fail('no command') } });
	const r = await h.converse('how are you doing');
	assert.equal(r.say, "Ha, I'm doing great. How about you?");
	assert.equal(r.followUp, true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://ollama.com/api/chat');
	assert.equal(calls[0].auth, 'Bearer k123');
	assert.equal(calls[0].body.model, 'gpt-oss:20b');
	assert.equal(calls[0].body.think, 'low');
	assert.deepEqual(
		calls[0].body.tools.map((t) => t.function.name),
		['wall', 'web_search']
	);
});

test('converse: a casual request runs a wall command and says what it did, in one model call', async () => {
	const ran = [];
	const { h, calls } = hub([{ message: { content: '', tool_calls: [call('wall', { command: 'turn it down' })] } }], {
		actions: {
			command: async (c) => {
				ran.push(c);
				return { say: 'Volume 40 percent.' };
			}
		}
	});
	const r = await h.converse("it's way too loud in here");
	assert.deepEqual(ran, ['turn it down']);
	assert.equal(r.say, 'Volume 40 percent.');
	assert.equal(r.acted, true);
	assert.equal(calls.length, 1);
	assert.equal(h.snapshot().actionsToday, 1);
});

test('converse: remember and play reach their actions', async () => {
	const added = [];
	const played = [];
	const actions = {
		add: async (text, source) => {
			added.push([text, source]);
			return { status: 201, data: { say: 'Added: Call mom, today at 5 PM.' } };
		},
		play: async (what) => {
			played.push(what);
			return { ok: true, say: 'Playing Jazz Radio.' };
		}
	};
	const { h } = hub(
		[
			{ message: { content: '', tool_calls: [call('remember', { text: 'call mom at 5pm' })] } },
			{ message: { content: '', tool_calls: [call('play', { what: 'some jazz' })] } }
		],
		{ actions }
	);
	assert.equal((await h.converse("don't let me forget mom at five", { source: 'Wall mic' })).say, 'Added: Call mom, today at 5 PM.');
	assert.deepEqual(added, [['call mom at 5pm', 'Wall mic']]);
	assert.equal((await h.converse('can we get some jazz going')).say, 'Playing Jazz Radio.');
	assert.deepEqual(played, ['some jazz']);
});

test('converse: a phrase that is not a command goes back to the model', async () => {
	const { h, calls } = hub(
		[{ message: { content: '', tool_calls: [call('wall', { command: 'make coffee' })] } }, { message: { content: "I can't make coffee, sadly." } }],
		{ actions: { command: async () => null } }
	);
	assert.equal((await h.converse('make me a coffee')).say, "I can't make coffee, sadly.");
	assert.match(calls[1].body.messages.at(-1).content, /isn't a display command/);
});

test('converse: searches, then answers; search stops being offered after two', async () => {
	const search = { message: { content: '', tool_calls: [call('web_search', { query: 'q' })] } };
	const results = { results: [{ title: 'Lightning win', content: 'Tampa Bay beat Boston 4-2.' }] };
	const { h, calls } = hub([search, results, search, results, { message: { content: 'They won 4 to 2.' } }]);
	assert.equal((await h.converse('did the lightning win')).say, 'They won 4 to 2.');
	assert.equal(calls[1].url, 'https://ollama.com/api/web_search');
	assert.equal(calls[1].body.max_results, 3);
	assert.match(calls[2].body.messages.at(-1).content, /Tampa Bay beat Boston/);
	assert.equal(calls.at(-1).body.tools, undefined);
	assert.equal(h.snapshot().searchesToday, 2);
});

test('converse: remembers recent exchanges for follow-ups', async () => {
	const { h, calls } = hub([{ message: { content: 'Mount Everest.' } }, { message: { content: 'It is 8,849 meters tall.' } }]);
	await h.converse('what is the tallest mountain');
	await h.converse('how tall is it');
	assert.deepEqual(
		calls[1].body.messages.map((m) => m.role),
		['system', 'user', 'assistant', 'user']
	);
});

test('converse: no key means null, so the wall asks before adding anything', async () => {
	const { h, calls } = hub([], { env: {} });
	assert.equal(await h.converse('how far is the moon'), null);
	assert.equal(calls.length, 0);
});

test('converse: reads the key from data/ollama-key', async () => {
	const dataDir = tmp();
	writeFileSync(path.join(dataDir, 'ollama-key'), 'filekey\n');
	const { h, calls } = hub([{ message: { content: 'Yes.' } }], { env: {}, dataDir });
	await h.converse('is water wet');
	assert.equal(calls[0].auth, 'Bearer filekey');
	assert.equal(h.snapshot().keySource, 'file');
});

test('converse: failures become sentences, never throws', async () => {
	for (const [status, re] of [
		[429, /free limit/],
		[401, /key was refused/],
		[500, /Try again/]
	]) {
		const { h } = hub([{ status }]);
		assert.match((await h.converse('what is the capital of peru')).say, re);
	}
});

test('TOOLS are compact', () => {
	assert.ok(JSON.stringify(Object.values(TOOLS)).length < 1600);
});
