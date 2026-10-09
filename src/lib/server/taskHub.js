/**
 * Chores / jobs / alerts, wired up: the HTTP API other platforms call, the
 * WebSocket ops the kiosk and phone remote use, the scheduler tick that
 * raises due items on the Dynamic Island, and webhook fan-out.
 *
 * HTTP (JSON; Bearer token required once one is configured):
 *   GET    /api/tasks                 list (?status=overdue,today… &kind=chore|alert)
 *   POST   /api/tasks                 create
 *   GET    /api/tasks/:id             one task
 *   PATCH  /api/tasks/:id             edit (POST works too, for clients without PATCH)
 *   DELETE /api/tasks/:id             remove
 *   POST   /api/tasks/:id/done        mark done (repeating items move to their next time)
 *   POST   /api/tasks/:id/snooze      { minutes }
 *
 * Siri / Shortcuts (answers carry a `say` sentence; add ?format=text, or send
 * Accept: text/plain, to get just that sentence back for "Speak Text"):
 *   POST   /api/tasks/say             { text } or a text/plain body: "remind me to … at 6pm",
 *                                     or a command ("I'm done with the bins"; see wallActions.js)
 *   GET    /api/tasks/brief           what's waiting and what's next, as one sentence
 *   POST   /api/tasks/next/done       tick off the most urgent waiting item (the Action button)
 *   POST   /api/tasks/next/snooze     { minutes } push it back instead
 *   GET    /api/webhooks              subscribers (secrets hidden)
 *   POST   /api/webhooks              { url, events?, secret?, name? }
 *   DELETE /api/webhooks/:id
 *
 * WebSocket (/ws): { type: 'tasks', op: 'create'|'update'|'done'|'snooze'|'delete'|'say', id?, task?, minutes?, text? }
 * and every change is broadcast as { type: 'tasks', tasks: [...] }.
 */
import path from 'node:path';
import {
	completeTask,
	describeRepeat,
	normalizeTask,
	snoozeTask,
	sortTasks,
	taskNotify,
	taskStatus,
	tickTasks
} from '../tasks.js';
import {
	authorized,
	deliverWebhooks,
	loadApiToken,
	loadTasks,
	loadWebhooks,
	newTaskId,
	normalizeWebhook,
	publicWebhook,
	saveTasks,
	saveWebhooks
} from './taskService.js';
import { parseQuick, pickNext, speakAdded, speakBrief, speakDone, speakWhen } from '../quickSay.js';

const MAX_BODY = 64 * 1024;

function cleanSource(v) {
	return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
}
const TICK_MS = 15000;
const ASK_WINDOW_MS = 2 * 60000;

function readBody(req) {
	const plain = /^text\/plain/i.test(req.headers?.['content-type'] ?? '');
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
			if (raw.length > MAX_BODY) {
				reject(Object.assign(new Error('body too large'), { status: 413 }));
				req.destroy();
			}
		});
		req.on('end', () => {
			if (!raw.trim()) return resolve({});
			try {
				resolve(JSON.parse(raw));
			} catch {
				// Shortcuts' "Get Contents of URL" can send dictated text as-is.
				// (fetch() labels any string body text/plain, so JSON wins first.)
				if (plain) return resolve({ text: raw });
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

export function createTaskHub({ dataDir, broadcast, log = console, now = () => Date.now(), env = process.env, fetchImpl, onEvent, commands }) {
	const tasksFile = path.join(dataDir, 'tasks.json');
	const hooksFile = path.join(dataDir, 'webhooks.json');
	const tokenFile = path.join(dataDir, 'api-token');

	let tasks = loadTasks(tasksFile);
	let hooks = loadWebhooks(hooksFile);
	let timer = 0;
	/** a question the wall just asked back, answered by the next sentence */
	let pendingAsk = null;

	/** What the kiosk, remote and API see: the task plus its live status. */
	function view(t, at = now()) {
		return { ...t, status: taskStatus(t, at), repeatText: describeRepeat(t.repeat) };
	}
	function snapshot() {
		const at = now();
		return sortTasks(tasks, at).map((t) => view(t, at));
	}
	function persist() {
		try {
			saveTasks(tasksFile, tasks);
		} catch (err) {
			log.error?.(`tasks: could not save ${tasksFile}: ${err.message}`);
		}
	}
	function changed(event, task) {
		persist();
		broadcast({ type: 'tasks', tasks: snapshot() });
		if (event) emit(event, { task: view(task) });
		if (event) onEvent?.(event, task);
	}
	function emit(event, payload) {
		if (!hooks.length) return;
		deliverWebhooks(hooks, event, payload, { fetchImpl, log }).catch(() => {});
	}

	/* ---------- operations shared by HTTP and WS ---------- */

	function create(input) {
		const { task, error } = normalizeTask(input, { now: now(), id: newTaskId() });
		if (error) return { error, status: 400 };
		tasks = [...tasks, task];
		changed('task.created', task);
		return { task: view(task) };
	}
	function find(id) {
		return tasks.find((t) => t.id === id);
	}
	function update(id, input) {
		const existing = find(id);
		if (!existing) return { error: 'not found', status: 404 };
		const { task, error } = normalizeTask(input, { now: now(), existing });
		if (error) return { error, status: 400 };
		tasks = tasks.map((t) => (t.id === id ? task : t));
		changed('task.updated', task);
		return { task: view(task) };
	}
	function remove(id) {
		const existing = find(id);
		if (!existing) return { error: 'not found', status: 404 };
		tasks = tasks.filter((t) => t.id !== id);
		changed('task.deleted', existing);
		return { ok: true };
	}
	function done(id) {
		const existing = find(id);
		if (!existing) return { error: 'not found', status: 404 };
		const task = completeTask(existing, now());
		tasks = tasks.map((t) => (t.id === id ? task : t));
		changed('task.done', task);
		return { task: view(task) };
	}
	function snooze(id, minutes) {
		const existing = find(id);
		if (!existing) return { error: 'not found', status: 404 };
		const task = snoozeTask(existing, minutes ?? 15, now());
		tasks = tasks.map((t) => (t.id === id ? task : t));
		changed('task.updated', task);
		return { task: view(task) };
	}

	/* ---------- scheduler ---------- */

	function tick() {
		const result = tickTasks(tasks, now());
		if (!result.fired.length) return result.fired;
		tasks = result.tasks;
		persist();
		for (const t of result.fired) {
			broadcast({ type: 'notify', ...taskNotify(t), taskId: t.id });
			emit('task.due', { task: view(t) });
			onEvent?.('task.due', t);
		}
		broadcast({ type: 'tasks', tasks: snapshot() });
		return result.fired;
	}
	function start() {
		setTimeout(tick, 3000);
		timer = setInterval(tick, TICK_MS);
		const open = tasks.filter((t) => t.active).length;
		const token = loadApiToken(tokenFile, env);
		log.log?.(`tasks: ${open} active, ${hooks.length} webhook(s), API ${token ? 'token required' : 'open on the LAN (no token set)'}`);
	}
	function stop() {
		clearInterval(timer);
	}

	/* ---------- WebSocket ---------- */

	function handleWs(msg) {
		if (msg?.type !== 'tasks') return null;
		if (msg.op === 'create') return create(msg.task || {});
		if (msg.op === 'update') return update(msg.id, msg.task || {});
		if (msg.op === 'done') return done(msg.id);
		if (msg.op === 'snooze') return snooze(msg.id, msg.minutes);
		if (msg.op === 'delete') return remove(msg.id);
		if (msg.op === 'say') {
			// the remote's "try a phrase" box; answers like Siri would (a promise)
			return sayAdd({ text: msg.text, source: 'Remote' }).then(({ status, data }) => ({ said: true, ok: status < 300, say: data.say }));
		}
		return null;
	}

	/* ---------- HTTP ---------- */

	function send(res, status, data) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	}
	function reply(res, result, okStatus = 200) {
		if (result.error) send(res, result.status || 400, { error: result.error });
		else send(res, okStatus, result);
	}
	/** Shortcuts answers: JSON with a `say` line, or just the line for "Speak Text". */
	function speak(req, res, url, status, data) {
		const wantsText = url.searchParams.get('format') === 'text' || /^text\/plain/i.test(req.headers.accept ?? '');
		if (!wantsText) return send(res, status, data);
		// Always 200 here: some Shortcuts setups stop on an error status
		// before "Speak Text" runs, and the sentence already says what went wrong.
		res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end(data.say ?? data.error ?? '');
	}

	/* ---------- Siri / Shortcuts ---------- */

	/**
	 * "Tell the wall": a command ("I'm done with the bins", "show the
	 * weather") when `commands` recognises one, otherwise something to add.
	 */
	async function sayAdd(body) {
		let text = typeof body === 'string' ? body : (body.text ?? body.say ?? '');

		// The wall asked "When should I remind you to call mom?" and this is
		// the answer ("at 5", "in two minutes"): finish that reminder.
		if (pendingAsk && now() < pendingAsk.until) {
			const ask = pendingAsk;
			pendingAsk = null;
			if (/^\s*(never ?mind|cancel|forget it|no|nothing)\b/i.test(text)) return { status: 200, data: { say: 'Okay, never mind.' } };
			if (parseQuick(text, now()).code === 'no-title') text = `${ask.kind === 'alert' ? 'remind me to ' : ''}${ask.title} ${text}`;
		}
		pendingAsk = null;

		const cmd = commands ? await commands(text) : null;
		if (cmd) return { status: 200, data: cmd };
		const parsed = parseQuick(text, now());
		if (parsed.code === 'no-time') pendingAsk = { title: parsed.title, kind: 'alert', until: now() + ASK_WINDOW_MS };
		if (parsed.error) return { status: 422, data: { error: parsed.error, say: parsed.error, asking: parsed.code === 'no-time' } };
		const result = create({ ...parsed.task, source: cleanSource(body.source) || 'Siri' });
		if (result.error) return { status: result.status || 400, data: { error: result.error, say: `Sorry, ${result.error}.` } };
		return { status: 201, data: { task: result.task, say: speakAdded(result.task, now()) } };
	}
	function brief() {
		const list = snapshot();
		return { say: speakBrief(list, now()), tasks: list.filter((t) => t.status !== 'done') };
	}
	function nextDone() {
		const target = pickNext(snapshot());
		if (!target) return { say: 'Nothing waiting. All clear.' };
		const { task } = done(target.id);
		const remaining = snapshot().filter((t) => t.status === 'overdue' || t.status === 'due').length;
		return { task, say: speakDone(task, remaining, now()) };
	}
	function nextSnooze(minutes) {
		const target = pickNext(snapshot());
		if (!target) return { say: 'Nothing waiting to snooze.' };
		const { task } = snooze(target.id, minutes ?? 60);
		return { task, say: `Snoozed ${task.title}. It comes back ${speakWhen(task.snoozedUntil, now())}.` };
	}

	/** Returns true when it handled the request. */
	async function handleHttp(req, res) {
		const url = new URL(req.url, 'http://local');
		const parts = url.pathname.split('/').filter(Boolean); // ['api','tasks',id?,action?]
		if (parts[0] !== 'api' || (parts[1] !== 'tasks' && parts[1] !== 'webhooks')) return false;

		// Re-read each time so minting or removing a token needs no restart.
		const token = loadApiToken(tokenFile, env);
		if (!authorized(req.headers, token)) {
			send(res, 401, { error: 'missing or wrong bearer token' });
			return true;
		}

		try {
			const m = req.method;
			const [, area, id, action] = parts;

			if (area === 'webhooks') {
				if (m === 'GET' && !id) return send(res, 200, { webhooks: hooks.map(publicWebhook) }), true;
				if (m === 'POST' && !id) {
					const { hook, error } = normalizeWebhook(await readBody(req));
					if (error) return send(res, 400, { error }), true;
					hooks = [...hooks, hook];
					saveWebhooks(hooksFile, hooks);
					return send(res, 201, { webhook: publicWebhook(hook) }), true;
				}
				if (m === 'DELETE' && id) {
					if (!hooks.some((h) => h.id === id)) return send(res, 404, { error: 'not found' }), true;
					hooks = hooks.filter((h) => h.id !== id);
					saveWebhooks(hooksFile, hooks);
					return send(res, 200, { ok: true }), true;
				}
				return send(res, 405, { error: 'method not allowed' }), true;
			}

			if (id === 'say' && !action) {
				if (m !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
				const { status, data } = await sayAdd(await readBody(req));
				return speak(req, res, url, status, data), true;
			}
			if (id === 'brief' && !action && m === 'GET') return speak(req, res, url, 200, brief()), true;
			if (id === 'next' && m === 'POST') {
				if (action === 'done') return speak(req, res, url, 200, nextDone()), true;
				if (action === 'snooze') return speak(req, res, url, 200, nextSnooze((await readBody(req)).minutes)), true;
			}

			if (!id) {
				if (m === 'GET') {
					const statuses = url.searchParams.get('status')?.split(',').filter(Boolean);
					const kind = url.searchParams.get('kind');
					let list = snapshot();
					if (statuses?.length) list = list.filter((t) => statuses.includes(t.status));
					if (kind) list = list.filter((t) => t.kind === kind);
					return send(res, 200, { tasks: list }), true;
				}
				if (m === 'POST') return reply(res, create(await readBody(req)), 201), true;
				return send(res, 405, { error: 'method not allowed' }), true;
			}

			if (action === 'done' && m === 'POST') return reply(res, done(id)), true;
			if (action === 'snooze' && m === 'POST') return reply(res, snooze(id, (await readBody(req)).minutes)), true;
			if (action) return send(res, 404, { error: 'unknown action' }), true;

			if (m === 'GET') {
				const t = find(id);
				return (t ? send(res, 200, { task: view(t) }) : send(res, 404, { error: 'not found' })), true;
			}
			if (m === 'PATCH' || m === 'POST') return reply(res, update(id, await readBody(req))), true;
			if (m === 'DELETE') return reply(res, remove(id)), true;
			return send(res, 405, { error: 'method not allowed' }), true;
		} catch (err) {
			send(res, err.status || 500, { error: err.status ? err.message : 'server error' });
			if (!err.status) log.error?.(`tasks: ${err.stack || err.message}`);
			return true;
		}
	}

	return { handleHttp, handleWs, snapshot, tick, start, stop, create, update, done, snooze, remove, sayAdd, brief, nextDone };
}
