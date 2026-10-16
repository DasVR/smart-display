import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isQuestion, spokenAnswer, systemPrompt } from '../src/lib/assistant.js';
import { createAssistantHub, searchDigest } from '../src/lib/server/assistantHub.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'assistant-'));

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

test('isQuestion: questions go to the assistant, chores and reminders do not', () => {
	for (const q of ['Hey wall, how far away is the moon?', 'can you tell me who won the game last night', 'what should I cook tonight', 'explain black holes', 'could you please look up the population of France', 'do you know a good pasta recipe', 'have we got rain coming'])
		assert.equal(isQuestion(q), true, q);
	for (const c of ['remind me to call mom at 5', 'take out the bins every monday', 'add milk', 'I need to buy milk', 'do the dishes', 'have the car washed saturday', ''])
		assert.equal(isQuestion(c), false, c);
});

test('spokenAnswer strips markdown, links and citations and keeps it short', () => {
	assert.equal(spokenAnswer('**The moon** is about [384,400 km](https://x.y) away.【1†source】'), 'The moon is about 384,400 km away.');
	assert.equal(spokenAnswer('- one\n- two'), 'one two');
	const long = 'This is a sentence that goes on for a while. '.repeat(20);
	assert.ok(spokenAnswer(long).length <= 320);
	assert.match(spokenAnswer(long), /\.$/);
});

test('systemPrompt is short and carries the date', () => {
	const p = systemPrompt({ now: Date.UTC(2026, 9, 16, 15), timeZone: 'America/New_York', place: 'Largo, Florida' });
	assert.match(p, /October 16, 2026/);
	assert.match(p, /Largo, Florida/);
	assert.ok(p.length < 400);
});

test('searchDigest keeps three trimmed results', () => {
	const rows = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, content: 'x'.repeat(1000) }));
	const digest = searchDigest(rows);
	assert.equal(digest.split('\n').length, 3);
	assert.ok(digest.length < 3 * 620);
	assert.equal(searchDigest([]), 'No results.');
});

test('ask: searches once, then answers in a sentence', async () => {
	const { fetchImpl, calls } = fakeOllama([
		{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'lightning score last night' } } }] } },
		{ results: [{ title: 'Lightning win', content: 'Tampa Bay beat Boston 4-2.' }] },
		{ message: { role: 'assistant', content: 'The **Lightning** beat Boston 4 to 2.' } }
	]);
	const hub = createAssistantHub({ dataDir: tmp(), fetchImpl, env: { OLLAMA_API_KEY: 'k123' } });
	const answer = await hub.ask('did the lightning win last night');
	assert.deepEqual(answer, { say: 'The Lightning beat Boston 4 to 2.', answered: true, model: 'gpt-oss:20b' });
	assert.equal(calls[0].url, 'https://ollama.com/api/chat');
	assert.equal(calls[0].auth, 'Bearer k123');
	assert.equal(calls[0].body.model, 'gpt-oss:20b');
	assert.equal(calls[0].body.think, 'low');
	assert.equal(calls[0].body.tools[0].function.name, 'web_search');
	assert.equal(calls[1].url, 'https://ollama.com/api/web_search');
	assert.equal(calls[1].body.max_results, 3);
	const toolMsg = calls[2].body.messages.at(-1);
	assert.equal(toolMsg.role, 'tool');
	assert.match(toolMsg.content, /Tampa Bay beat Boston/);
	assert.equal(hub.snapshot().searchesToday, 1);
});

test('ask: stops offering the search tool after two searches', async () => {
	const search = { message: { content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'q' } } }] } };
	const results = { results: [] };
	const { fetchImpl, calls } = fakeOllama([search, results, search, results, { message: { content: 'Best guess.' } }]);
	const hub = createAssistantHub({ dataDir: tmp(), fetchImpl, env: { OLLAMA_API_KEY: 'k' } });
	assert.equal((await hub.ask('what is going on')).say, 'Best guess.');
	assert.equal(calls.at(-1).body.tools, undefined);
});

test('ask: remembers the last exchange for a follow-up', async () => {
	const { fetchImpl, calls } = fakeOllama([{ message: { content: 'Mount Everest.' } }, { message: { content: 'It is 8,849 meters tall.' } }]);
	const hub = createAssistantHub({ dataDir: tmp(), fetchImpl, env: { OLLAMA_API_KEY: 'k' } });
	await hub.ask('what is the tallest mountain');
	await hub.ask('how tall is it');
	const roles = calls[1].body.messages.map((m) => m.role);
	assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
	assert.equal(calls[1].body.messages[2].content, 'Mount Everest.');
});

test('ask: no key means no answer, so the sentence goes on the list as before', async () => {
	const hub = createAssistantHub({ dataDir: tmp(), fetchImpl: async () => assert.fail('no call'), env: {} });
	assert.equal(await hub.ask('how far is the moon'), null);
	assert.equal(await hub.maybeAnswer('how far is the moon'), null);
});

test('ask: reads the key from data/ollama-key', async () => {
	const dir = tmp();
	writeFileSync(path.join(dir, 'ollama-key'), 'filekey\n');
	const { fetchImpl, calls } = fakeOllama([{ message: { content: 'Yes.' } }]);
	const hub = createAssistantHub({ dataDir: dir, fetchImpl, env: {} });
	await hub.ask('is water wet');
	assert.equal(calls[0].auth, 'Bearer filekey');
	assert.equal(hub.snapshot().keySource, 'file');
});

test('ask: failures become sentences, never throws', async () => {
	for (const [status, re] of [
		[429, /free limit/],
		[401, /key was refused/],
		[500, /couldn't reach/]
	]) {
		const { fetchImpl } = fakeOllama([{ status }]);
		const hub = createAssistantHub({ dataDir: tmp(), fetchImpl, env: { OLLAMA_API_KEY: 'k' }, log: { warn() {} } });
		const r = await hub.ask('what is the capital of peru');
		assert.equal(r.answered, false);
		assert.match(r.say, re);
	}
});

test('maybeAnswer leaves chores alone', async () => {
	const hub = createAssistantHub({ dataDir: tmp(), fetchImpl: async () => assert.fail('no call'), env: { OLLAMA_API_KEY: 'k' } });
	assert.equal(await hub.maybeAnswer('take out the bins at 6'), null);
});
