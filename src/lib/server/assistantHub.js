/**
 * The wall in conversation, from a small model on Ollama Cloud
 * (model: src/lib/assistant.js).
 *
 *   GET  /api/assistant        whether a key is set, the model, today's counts
 *   POST /api/assistant/ask    { text } (or a text/plain body): { say }
 *
 * Same Bearer token as /api/tasks. Everything said to the wall reaches it
 * through taskHub.sayAdd once the fixed commands and "remind me / add …"
 * have had their turn: questions, chat, and casual ways of asking for
 * things ("it's way too loud", "can we get some music going"). It answers,
 * or acts through its tools:
 *
 *   wall        a display command in plain words ("turn it down"), run by actionHub
 *   remember    add to the list, only when clearly asked to remember something
 *   play        Apple Music on the wall
 *   web_search  Ollama's web search, three trimmed results
 *
 * When it only acts, the action's own sentence is what the wall says ("Volume
 * 40 percent."): no second model call. Cheap on purpose: one small model
 * (ASSISTANT_MODEL, default gpt-oss:20b), a short prompt, low reasoning
 * effort, at most two searches and three rounds per sentence, and only the
 * last three exchanges kept. The key comes from OLLAMA_API_KEY or
 * data/ollama-key (gitignored) and is never sent back out.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TOOLS, asksBack, spokenAnswer, systemPrompt } from '../assistant.js';
import { authorized, loadApiToken } from './taskService.js';

const API = 'https://ollama.com/api';
const DEFAULT_MODEL = 'gpt-oss:20b';
const TIMEOUT_MS = 20000;
const SEARCH_RESULTS = 3;
const SNIPPET_CHARS = 600;
const MAX_SEARCHES = 2;
const MAX_ROUNDS = 3;
const MEMORY_MS = 5 * 60000;
const MEMORY_TURNS = 3;
const MAX_BODY = 4 * 1024;

export function loadOllamaKey(file, env = process.env) {
	const fromEnv = String(env.OLLAMA_API_KEY || '').trim();
	if (fromEnv) return fromEnv;
	try {
		if (existsSync(file)) return readFileSync(file, 'utf8').trim();
	} catch {
		/* unreadable: no key */
	}
	return '';
}

/** Search results as a short block of text for the model. */
export function searchDigest(results) {
	const rows = Array.isArray(results) ? results.slice(0, SEARCH_RESULTS) : [];
	if (!rows.length) return 'No results.';
	return rows
		.map((r, i) => `${i + 1}. ${String(r?.title || '').trim()}: ${String(r?.content || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS)}`)
		.join('\n');
}

function readBody(req) {
	const plain = /^text\/plain/i.test(req.headers?.['content-type'] ?? '');
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (c) => {
			raw += c;
			if (raw.length > MAX_BODY) {
				reject(Object.assign(new Error('body too large'), { status: 413 }));
				req.destroy();
			}
		});
		req.on('end', () => {
			if (!raw.trim()) return resolve({});
			try {
				const v = JSON.parse(raw);
				resolve(v && typeof v === 'object' ? v : { text: String(v) });
			} catch {
				if (plain) return resolve({ text: raw.trim() });
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

/**
 * @param {object} o
 * @param {{ command?: (text: string) => Promise<object|null>, add?: (text: string, source: string) => Promise<object>, play?: (text: string) => Promise<object> }} [o.actions]
 *   what the wall can do; a tool is only offered when its action is here
 */
export function createAssistantHub({
	dataDir,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	env = process.env,
	log = console,
	timeZone = 'America/New_York',
	place = '',
	actions = {}
}) {
	const keyFile = path.join(dataDir, 'ollama-key');
	const tokenFile = path.join(dataDir, 'api-token');
	const model = String(env.ASSISTANT_MODEL || '').trim() || DEFAULT_MODEL;
	const key = () => loadOllamaKey(keyFile, env);
	/** the last few exchanges, for "and tomorrow?" */
	let memory = [];
	let tally = { day: '', count: 0, searches: 0, actions: 0 };

	function today() {
		return new Date(now()).toISOString().slice(0, 10);
	}
	function count(field) {
		if (tally.day !== today()) tally = { day: today(), count: 0, searches: 0, actions: 0 };
		tally[field] += 1;
	}

	function snapshot() {
		const k = key();
		const fresh = tally.day === today();
		return {
			hasKey: Boolean(k),
			keySource: !k ? '' : String(env.OLLAMA_API_KEY || '').trim() ? 'env' : 'file',
			model,
			askedToday: fresh ? tally.count : 0,
			searchesToday: fresh ? tally.searches : 0,
			actionsToday: fresh ? tally.actions : 0
		};
	}

	async function post(endpoint, body, signal) {
		const res = await fetchImpl(`${API}/${endpoint}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal
		});
		if (!res.ok) throw Object.assign(new Error(`ollama ${endpoint} ${res.status}`), { status: res.status });
		return res.json();
	}

	function offered(searches) {
		const tools = [];
		if (actions.command) tools.push(TOOLS.wall);
		if (actions.add) tools.push(TOOLS.remember);
		if (actions.play) tools.push(TOOLS.play);
		if (searches < MAX_SEARCHES) tools.push(TOOLS.web_search);
		return tools;
	}

	/** Run one tool call: { say, done } where done means the sentence is the answer. */
	async function runTool(call, source, signal) {
		const name = call?.function?.name;
		const args = call?.function?.arguments || {};
		if (name === 'web_search') {
			count('searches');
			const data = await post('web_search', { query: String(args.query || '').slice(0, 200), max_results: SEARCH_RESULTS }, signal);
			return { result: searchDigest(data?.results), done: false };
		}
		if (name === 'wall' && actions.command) {
			const r = await actions.command(String(args.command || ''));
			if (!r) return { result: `"${args.command}" isn't a display command.`, done: false };
			count('actions');
			return { result: r.say || 'Done.', say: r.say, done: true };
		}
		if (name === 'remember' && actions.add) {
			const r = await actions.add(String(args.text || ''), source);
			count('actions');
			return { result: r?.data?.say || 'Added.', say: r?.data?.say, done: true };
		}
		if (name === 'play' && actions.play) {
			const r = await actions.play(String(args.what || ''));
			count('actions');
			return { result: r?.say || 'Playing.', say: r?.say, done: true };
		}
		return { result: `No tool named ${name}.`, done: false };
	}

	function remember(q, a) {
		memory.push({ q, a, at: now() });
		memory = memory.slice(-MEMORY_TURNS);
	}

	/**
	 * Something said to the wall that wasn't a fixed command. Resolves
	 * `{ say, followUp }`, or null with no key (taskHub then falls back to
	 * asking before adding anything). Never rejects: a failure is a sentence.
	 */
	async function converse(said, { source = 'Wall' } = {}) {
		const text = String(said || '').trim();
		if (!text || !key()) return null;
		count('count');
		const signal = AbortSignal.timeout(TIMEOUT_MS);
		memory = memory.filter((m) => now() - m.at < MEMORY_MS);
		const messages = [
			{ role: 'system', content: systemPrompt({ now: now(), timeZone, place }) },
			...memory.flatMap((m) => [
				{ role: 'user', content: m.q },
				{ role: 'assistant', content: m.a }
			]),
			{ role: 'user', content: text }
		];
		try {
			let searches = 0;
			for (let round = 0; round < MAX_ROUNDS; round++) {
				const last = round === MAX_ROUNDS - 1;
				const tools = last ? [] : offered(searches);
				const data = await post('chat', { model, messages, stream: false, think: 'low', ...(tools.length ? { tools } : {}) }, signal);
				const msg = data?.message || {};
				const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
				if (!calls.length) {
					const say = spokenAnswer(msg.content);
					if (!say) break;
					remember(text, say);
					return { say, followUp: asksBack(say), model };
				}
				// keep what it asked for, not what it thought: thinking costs tokens to resend
				messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
				const outs = [];
				for (const call of calls) {
					if (call?.function?.name === 'web_search') searches += 1;
					const out = await runTool(call, source, signal);
					outs.push(out);
					messages.push({ role: 'tool', tool_name: call?.function?.name, content: out.result });
				}
				// it only acted: the actions already said what happened
				if (outs.every((o) => o.done)) {
					const say = outs.map((o) => o.say).filter(Boolean).join(' ') || 'Done.';
					remember(text, say);
					return { say, followUp: asksBack(say), model, acted: true };
				}
			}
			return { say: "Sorry, I'm not sure about that one.", model };
		} catch (e) {
			log.warn?.(`assistant: ${e.message}`);
			if (e.status === 401 || e.status === 403) return { say: 'My Ollama key was refused. Check it on the wall.' };
			if (e.status === 429) return { say: "I've hit today's free limit. Try again later." };
			if (e.name === 'TimeoutError' || e.name === 'AbortError') return { say: 'That took me too long. Try asking again.' };
			return { say: "I can't think straight right now. Try again in a bit." };
		}
	}

	async function handleHttp(req, res) {
		const url = new URL(req.url, 'http://local');
		if (!url.pathname.startsWith('/api/assistant')) return false;
		const send = (status, data) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(data));
		};
		if (!authorized(req.headers, loadApiToken(tokenFile, env))) {
			send(401, { error: 'unauthorized' });
			return true;
		}
		if (req.method === 'GET' && url.pathname === '/api/assistant') {
			send(200, snapshot());
			return true;
		}
		if (req.method === 'POST' && url.pathname === '/api/assistant/ask') {
			try {
				const body = await readBody(req);
				const answer = await converse(body.text, { source: 'API' });
				if (!answer) send(503, { error: 'no-key', say: 'Set an Ollama API key first.' });
				else send(200, answer);
			} catch (e) {
				send(e.status || 400, { error: e.message });
			}
			return true;
		}
		send(404, { error: 'not found' });
		return true;
	}

	return { converse, snapshot, handleHttp };
}
