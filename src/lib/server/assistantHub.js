/**
 * Answers to open questions, from a small model on Ollama Cloud
 * (model: src/lib/assistant.js).
 *
 *   GET  /api/assistant        whether a key is set, the model, today's count
 *   POST /api/assistant/ask    { text } (or a text/plain body): { say }
 *
 * Same Bearer token as /api/tasks. "Tell the wall" and "hey wall" reach it
 * through taskHub: a sentence that isn't a command and reads like a question
 * comes here instead of becoming a chore.
 *
 * Cheap on purpose: one small model (ASSISTANT_MODEL, default gpt-oss:20b),
 * a four-line system prompt, low reasoning effort, one tool (Ollama's
 * web_search, three results, trimmed), at most two searches per question,
 * and only the last two exchanges kept for follow-ups. The key comes from
 * OLLAMA_API_KEY or data/ollama-key (gitignored) and is never sent back out.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isQuestion, spokenAnswer, systemPrompt } from '../assistant.js';
import { authorized, loadApiToken } from './taskService.js';

const API = 'https://ollama.com/api';
const DEFAULT_MODEL = 'gpt-oss:20b';
const ASK_TIMEOUT_MS = 20000;
const SEARCH_RESULTS = 3;
const SNIPPET_CHARS = 600;
const MAX_SEARCHES = 2;
const MEMORY_MS = 3 * 60000;
const MAX_BODY = 4 * 1024;

const SEARCH_TOOL = {
	type: 'function',
	function: {
		name: 'web_search',
		description: 'Search the web',
		parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
	}
};

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

export function createAssistantHub({
	dataDir,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	env = process.env,
	log = console,
	timeZone = 'America/New_York',
	place = ''
}) {
	const keyFile = path.join(dataDir, 'ollama-key');
	const tokenFile = path.join(dataDir, 'api-token');
	const model = String(env.ASSISTANT_MODEL || '').trim() || DEFAULT_MODEL;
	const key = () => loadOllamaKey(keyFile, env);
	/** the last couple of exchanges, for "and how tall is it?" */
	let memory = [];
	let asked = { day: '', count: 0, searches: 0 };

	function tally(field) {
		const day = new Date(now()).toISOString().slice(0, 10);
		if (asked.day !== day) asked = { day, count: 0, searches: 0 };
		asked[field] += 1;
	}

	function snapshot() {
		const k = key();
		return {
			hasKey: Boolean(k),
			keySource: !k ? '' : String(env.OLLAMA_API_KEY || '').trim() ? 'env' : 'file',
			model,
			askedToday: asked.day === new Date(now()).toISOString().slice(0, 10) ? asked.count : 0,
			searchesToday: asked.day === new Date(now()).toISOString().slice(0, 10) ? asked.searches : 0
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

	async function search(query, signal) {
		tally('searches');
		const data = await post('web_search', { query: String(query || '').slice(0, 200), max_results: SEARCH_RESULTS }, signal);
		return searchDigest(data?.results);
	}

	/**
	 * Answer a question out loud: `{ say, answered: true }`, or null when
	 * there's no key (the sentence then goes on the list as before).
	 * Never rejects: a failure is a sentence saying so.
	 */
	async function ask(question) {
		const text = String(question || '').trim();
		if (!text || !key()) return null;
		tally('count');
		const signal = AbortSignal.timeout(ASK_TIMEOUT_MS);
		memory = memory.filter((m) => now() - m.at < MEMORY_MS).slice(-2);
		const messages = [
			{ role: 'system', content: systemPrompt({ now: now(), timeZone, place }) },
			...memory.flatMap((m) => [
				{ role: 'user', content: m.q },
				{ role: 'assistant', content: m.a }
			]),
			{ role: 'user', content: text }
		];
		try {
			for (let round = 0; round <= MAX_SEARCHES; round++) {
				const tools = round < MAX_SEARCHES ? [SEARCH_TOOL] : undefined;
				const data = await post('chat', { model, messages, stream: false, think: 'low', ...(tools ? { tools } : {}) }, signal);
				const msg = data?.message || {};
				const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
				if (!calls.length || !tools) {
					const say = spokenAnswer(msg.content);
					if (!say) break;
					memory.push({ q: text, a: say, at: now() });
					return { say, answered: true, model };
				}
				// keep what it asked for, not what it thought: thinking costs tokens to resend
				messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
				for (const call of calls) {
					const fn = call?.function || {};
					const result = fn.name === 'web_search' ? await search(fn.arguments?.query, signal) : `No tool named ${fn.name}.`;
					messages.push({ role: 'tool', tool_name: fn.name, content: result });
				}
			}
			return { say: "Sorry, I couldn't find an answer to that.", answered: false };
		} catch (e) {
			log.warn?.(`assistant: ${e.message}`);
			if (e.status === 401 || e.status === 403) return { say: 'My Ollama key was refused. Check it on the wall.', answered: false };
			if (e.status === 429) return { say: "I've hit today's free limit for questions. Try again later.", answered: false };
			if (e.name === 'TimeoutError' || e.name === 'AbortError') return { say: 'That took too long to look up. Try asking again.', answered: false };
			return { say: "I couldn't reach my answers right now.", answered: false };
		}
	}

	/** taskHub's hook: only questions, and only with a key. */
	async function maybeAnswer(text) {
		if (!key() || !isQuestion(text)) return null;
		return ask(text);
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
				const answer = await ask(body.text);
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

	return { ask, maybeAnswer, snapshot, handleHttp };
}
