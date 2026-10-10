/**
 * The Action button and spoken commands (model: src/lib/wallActions.js).
 *
 *   POST /api/action            one press: the most useful thing right now
 *   GET  /api/action/menu       choices for the "Wall menu" shortcut
 *                               (?format=text: one label per line, for Choose from List)
 *   POST /api/action/run        { choice } (or a text/plain body): run the chosen label
 *
 * Same Bearer token as /api/tasks. Answers carry a `say` sentence; with
 * ?format=text (or Accept: text/plain) you get just the sentence, always 200,
 * so Shortcuts reaches Speak Text / Show Notification. Every action also
 * flashes on the wall's island so you can see the press land.
 *
 * `command(text)` is how "tell the wall" runs commands: taskHub's /say
 * tries it first and only adds a chore when it returns null.
 */
import path from 'node:path';
import { departureBoard, currentDeparture } from '../departures.js';
import { speakBrief, speakDone, speakWhen } from '../quickSay.js';
import {
	buildMenu,
	findMenuItem,
	matchTask,
	parseCommand,
	pickPress,
	speakBoard,
	speakTimersLeft,
	speakTomorrow,
	speakWeather,
	activeTimers,
	viewName
} from '../wallActions.js';
import { authorized, loadApiToken } from './taskService.js';

const MAX_BODY = 8 * 1024;
const CONTEXT_TTL_MS = 10 * 60000;
/** A lookup that takes longer than this is skipped: a press must always answer quickly. */
const LOOKUP_MS = 2500;
const SCREEN_MS = 4000;
const EVENTS = ['morning', 'night', 'home', 'leaving'];

function withTimeout(promise, ms) {
	return Promise.race([Promise.resolve(promise), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
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
				resolve(v && typeof v === 'object' ? v : { choice: String(v) });
			} catch {
				if (plain) return resolve({ choice: raw.trim(), text: raw.trim() });
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

export function createActionHub({
	dataDir,
	taskHub,
	approvalHub,
	broadcast,
	getState = () => ({}), // { nowPlaying, view, hdmi }
	navigate = () => {},
	player = async () => ({ ok: false }),
	screen = async () => {},
	loadWeather = async () => null,
	loadEvents = async () => [],
	now = () => Date.now(),
	env = process.env,
	log = console
}) {
	const tokenFile = path.join(dataDir, 'api-token');
	const cache = { weather: null, events: [], at: 0 };

	/** Weather and calendar, cached 10 minutes; a slow or failed lookup keeps the last good copy. */
	async function refreshContext() {
		if (cache.at && now() - cache.at < CONTEXT_TTL_MS) return;
		cache.at = now();
		const [w, e] = await Promise.allSettled([withTimeout(loadWeather(), LOOKUP_MS), withTimeout(loadEvents(), LOOKUP_MS)]);
		if (w.status === 'fulfilled' && w.value) cache.weather = w.value;
		if (e.status === 'fulfilled' && Array.isArray(e.value)) cache.events = e.value;
		if (w.status === 'rejected' && !cache.weather) cache.at = 0; // try again next time
	}

	async function boardFor(tasks) {
		if (!currentDeparture(tasks, now())) return null;
		await refreshContext();
		return departureBoard({ tasks, events: cache.events, weather: cache.weather, now: now() });
	}

	async function context() {
		const tasks = taskHub.snapshot();
		const state = getState() || {};
		return {
			tasks,
			approvals: approvalHub?.snapshot() ?? [],
			board: await boardFor(tasks),
			undo: taskHub.undoLabel?.() ?? '',
			...state
		};
	}

	async function screenTo(state) {
		await Promise.race([Promise.resolve(screen(state)).catch(() => {}), new Promise((r) => setTimeout(r, SCREEN_MS))]);
	}

	function flash(title, body = '') {
		broadcast?.({ type: 'notify', title, body, severity: 'info', source: 'iPhone', kind: 'action', ttl: 6000 });
	}

	function waitingCount() {
		return taskHub.snapshot().filter((t) => t.status === 'overdue' || t.status === 'due').length;
	}

	/** Run one resolved action. Returns { say, ... }. */
	async function run(action, ctx, query = '') {
		switch (action.intent) {
			case 'brief':
				return { say: speakBrief(ctx.tasks, now()) };
			case 'dictate':
				return { say: 'Use the Tell the wall shortcut to say something to the wall.' };
			case 'board': {
				if (!ctx.board) return { say: 'No departure coming up. ' + speakBrief(ctx.tasks, now()) };
				navigate('clock');
				return { say: speakBoard(ctx.board) };
			}
			case 'approval-read': {
				const a = ctx.approvals[0];
				return { say: `${a.source} is waiting: ${a.title}${a.detail ? ` ${a.detail.split('\n')[0]}` : ''}. Hold the button for Allow or Deny, or answer on the wall.` };
			}
			case 'approval': {
				const a = action.approvalId ? ctx.approvals.find((x) => x.id === action.approvalId) : ctx.approvals[0];
				if (!a) return { say: 'Nothing is waiting for an answer.' };
				const r = approvalHub.decide(a.id, action.decision, 'iPhone');
				if (r.error) return { say: `Couldn't answer: ${r.error}.` };
				flash(action.decision === 'allow' ? 'Allowed from iPhone' : 'Denied from iPhone', a.detail || a.title);
				return { say: `${action.decision === 'allow' ? 'Allowed' : 'Denied'}: ${a.detail || a.title}.` };
			}
			case 'done': {
				let id = action.taskId;
				if (!id) {
					const t = query ? matchTask(ctx.tasks, query) : ctx.tasks.find((x) => ['overdue', 'due', 'today'].includes(x.status));
					if (!t) return { say: query ? `I couldn't find "${query}" on the wall.` : 'Nothing waiting. All clear.' };
					// "done with the sheets" right after ticking them off must not
					// skip the next occurrence too
					if (t.status === 'upcoming') return { say: `${t.title} isn't due until ${speakWhen(t.nextDue, now())}. Nothing to tick off yet.` };
					id = t.id;
				}
				const r = taskHub.done(id, { undo: true });
				if (r.error) return { say: `Couldn't tick that off: ${r.error}.` };
				flash(`Done: ${r.task.title}`);
				return { task: r.task, say: speakDone(r.task, waitingCount(), now()) };
			}
			case 'snooze': {
				let id = action.taskId;
				if (!id) {
					const t = query ? matchTask(ctx.tasks, query) : ctx.tasks.find((x) => ['overdue', 'due', 'today'].includes(x.status));
					if (!t) return { say: query ? `I couldn't find "${query}" on the wall.` : 'Nothing waiting to snooze.' };
					id = t.id;
				}
				const r = taskHub.snooze(id, action.minutes ?? 60, { undo: true });
				if (r.error) return { say: `Couldn't snooze that: ${r.error}.` };
				flash(`Snoozed: ${r.task.title}`);
				return { task: r.task, say: `Snoozed ${r.task.title}. It comes back ${speakWhen(r.task.snoozedUntil, now())}.` };
			}
			case 'show':
				navigate(action.view);
				return { say: `Showing ${viewName(action.view)}.` };
			case 'music': {
				const r = await player(action.action);
				if (!r?.ok) return { say: 'The music player didn’t answer.' };
				const words = { pause: 'Paused.', play: 'Playing.', next: 'Next song.', previous: 'Previous song.' };
				return { say: words[action.action] || 'Done.' };
			}
			case 'screen':
				await screenTo(action.state);
				return { say: action.state === 'off' ? 'Screen off. Good night.' : 'Screen on.' };
			case 'undo': {
				const r = taskHub.undoLast();
				if (r.say && !/^Nothing|couldn/i.test(r.say)) flash('Undone');
				return { say: r.say };
			}
			case 'weather': {
				await refreshContext();
				return { say: cache.weather ? speakWeather(cache.weather, now()) : "I couldn't get the weather right now." };
			}
			case 'tomorrow':
				return { say: speakTomorrow(ctx.tasks, now()) };
			case 'timer-left':
				return { say: speakTimersLeft(ctx.tasks, now()) };
			case 'cancel-timer': {
				const timers = activeTimers(ctx.tasks, now());
				if (!timers.length) return { say: 'No timers running.' };
				for (const t of timers) taskHub.remove(t.id);
				flash(timers.length === 1 ? 'Timer cancelled' : 'Timers cancelled');
				return { say: timers.length === 1 ? 'Timer cancelled.' : `${timers.length} timers cancelled.` };
			}
			default:
				return { say: "I'm not sure what to do with that." };
		}
	}

	async function press() {
		const ctx = await context();
		const action = pickPress(ctx);
		const out = await run(action, ctx);
		return { did: action.intent, ...out };
	}

	async function menu() {
		const ctx = await context();
		const items = buildMenu(ctx);
		return { items: items.map(({ id, label }) => ({ id, label })), say: items.map((i) => i.label).join('\n') };
	}

	async function choose(choice) {
		const ctx = await context();
		const item = findMenuItem(buildMenu(ctx), choice);
		if (!item) return { say: 'That choice has gone; the wall changed. Try again.' };
		const out = await run(item, ctx);
		return { did: item.id, ...out };
	}

	/** Spoken command from "tell the wall", or null to let it be added. */
	async function command(text) {
		const cmd = parseCommand(text);
		if (!cmd) return null;
		const ctx = await context();
		const out = await run(cmd, ctx, cmd.query || '');
		return { did: cmd.intent, ...out };
	}

	/**
	 * One-URL automations: Shortcuts' Personal Automations (arrive home,
	 * alarm stops, CarPlay connects, a time of day) just call this and speak
	 * the answer. morning: screen on, board, weather, brief. night: tomorrow,
	 * then screen off. home: welcome and brief. leaving: the board.
	 */
	async function event(name) {
		if (!EVENTS.includes(name)) return { say: `I don't know the ${name} automation. Try ${EVENTS.join(', ')}.`, error: 'unknown event' };
		const ctx = await context();
		const brief = speakBrief(ctx.tasks, now());
		if (name === 'morning') {
			await screenTo('on');
			navigate('clock');
			await refreshContext();
			const parts = ['Good morning.'];
			if (ctx.board) parts.push(speakBoard(ctx.board));
			if (cache.weather) parts.push(speakWeather(cache.weather, now()));
			parts.push(brief);
			return { did: name, say: parts.join(' ') };
		}
		if (name === 'night') {
			const say = `${speakTomorrow(ctx.tasks, now())} Good night.`;
			await screenTo('off');
			return { did: name, say };
		}
		if (name === 'home') {
			await screenTo('on');
			navigate('clock');
			return { did: name, say: `Welcome home. ${brief}` };
		}
		// leaving
		navigate('clock');
		const waiting = waitingCount();
		return {
			did: name,
			say: ctx.board
				? speakBoard(ctx.board)
				: `Nothing on the board. ${waiting ? `${waiting} thing${waiting === 1 ? ' is' : 's are'} still waiting.` : 'Everything is done. Have a good one.'}`
		};
	}

	function send(req, res, url, status, data) {
		const wantsText = url.searchParams.get('format') === 'text' || /^text\/plain/i.test(req.headers.accept ?? '');
		if (!wantsText) {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			return res.end(JSON.stringify(data));
		}
		res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end(data.say ?? data.error ?? '');
	}

	async function handleHttp(req, res) {
		const url = new URL(req.url, 'http://local');
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts[0] !== 'api' || parts[1] !== 'action') return false;
		if (!authorized(req.headers, loadApiToken(tokenFile, env))) {
			send(req, res, url, 401, { error: 'missing or wrong bearer token', say: 'The wall wants a token. Check the shortcut header.' });
			return true;
		}
		try {
			const sub = parts[2];
			if (!sub && req.method === 'POST') return send(req, res, url, 200, await press()), true;
			if (sub === 'menu' && req.method === 'GET') return send(req, res, url, 200, await menu()), true;
			if (sub === 'event' && parts[3] && (req.method === 'POST' || req.method === 'GET')) {
				return send(req, res, url, 200, await event(parts[3].toLowerCase())), true;
			}
			if (sub === 'run' && req.method === 'POST') {
				const body = await readBody(req);
				return send(req, res, url, 200, await choose(body.choice ?? body.label ?? body.id ?? body.text)), true;
			}
			return send(req, res, url, 405, { error: 'method not allowed' }), true;
		} catch (err) {
			send(req, res, url, err.status || 500, { error: err.status ? err.message : 'server error', say: 'Something went wrong on the wall.' });
			if (!err.status) log.error?.(`action: ${err.stack || err.message}`);
			return true;
		}
	}

	return { handleHttp, press, menu, choose, command, event };
}
