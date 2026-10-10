/**
 * What the Action button and "tell the wall" can do beyond adding things.
 *
 *  - pickPress(ctx): one press does the most useful thing right now.
 *      an agent is waiting      -> read the request out (never auto-allow)
 *      a departure is on        -> read the board, bring it up on the wall
 *      something's waiting      -> tick off the most urgent item
 *      otherwise                -> the brief
 *  - buildMenu(ctx): the "Wall menu" shortcut's choices, built from what's
 *    on the wall this second (Done: Feed the cat, Allow: git push, Pause
 *    music, Screen off…).
 *  - parseCommand(text): spoken commands for "tell the wall" ("I'm done
 *    with the bins", "snooze the cat for an hour", "show the weather",
 *    "pause the music", "I'm leaving"). Anything that isn't a command is
 *    left for quickSay to add as a chore or alert.
 *
 * Pure: src/lib/server/actionHub.js runs the actions; tests/wall-actions.test.mjs.
 */

import { cleanSpeech, speakDuration } from './quickSay.js';
import { eventDayKey, wallClock, wallDayKey } from './calendarItems.js';

export const VIEWS = { clock: 'clock', time: 'clock', school: 'school', homework: 'school', agents: 'agents', music: 'music', weather: 'weather', radar: 'weather' };
const VIEW_NAMES = { clock: 'the clock', school: 'school', agents: 'the agents', music: 'music', weather: 'the weather' };

/** The menu's first item: the shortcut dictates and sends it to /api/tasks/say. */
export const DICTATE_LABEL = 'Tell the wall';

const FILLER = new Set(['the', 'a', 'an', 'my', 'our', 'to', 'with', 'of', 'for', 'out', 'up', 'please']);

function words(s) {
	return String(s || '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((w) => w && !FILLER.has(w))
		.map((w) => w.replace(/(ing|es|s)$/, '') || w);
}

/**
 * Find the task a spoken phrase means. Word overlap, then urgency: "the
 * bins" finds "Take out the bins"; "cat" finds "Feed the cat".
 */
export function matchTask(views, query) {
	const q = words(query);
	if (!q.length) return null;
	const rank = { overdue: 0, due: 0, today: 1, snoozed: 2, upcoming: 3, done: 9 };
	let best = null;
	for (const t of views || []) {
		if (t.status === 'done') continue;
		const tw = new Set(words(t.title));
		const hits = q.filter((w) => tw.has(w)).length;
		if (!hits) continue;
		const score = hits / q.length + hits / Math.max(1, tw.size) - (rank[t.status] ?? 5) * 0.01;
		if (!best || score > best.score) best = { task: t, score };
	}
	return best && best.score >= 0.5 ? best.task : null;
}

function minutesFrom(n, unit) {
	const v = /^an?$/i.test(n) ? 1 : n === 'half an' ? 0.5 : Number(n);
	if (!Number.isFinite(v) || v <= 0) return null;
	return Math.round(v * (/^h/i.test(unit) ? 60 : /^d/i.test(unit) ? 1440 : 1));
}

/**
 * A spoken command, or null when the sentence is something to add.
 * Returns { intent, ... }.
 */
export function parseCommand(text) {
	const s = cleanSpeech(text);
	if (!s) return null;
	let m;

	// adding always wins: "remind me…", "add…", and a timer being set
	if (/^(remind|alert|ping|add|chore|to-?do|i need to|i have to|i've got to|i gotta)\b/i.test(s)) return null;

	if (/^(undo|undo (that|it|this)|scratch that|take that back|oops|that was (wrong|a mistake)|cancel that|never ?mind that)$/i.test(s)) return { intent: 'undo' };

	if (/^(cancel|stop|clear|delete|kill|turn off)\s+(?:the |my |all )?(?:\w+ )?timers?$/i.test(s)) return { intent: 'cancel-timer' };
	if (/^how (?:long|much)\b.*\b(?:timer|left)\b|^(?:how much )?time (?:is )?(?:left|remaining)\b|^timers?$/i.test(s)) return { intent: 'timer-left' };

	if (/^(?:what'?s|whats|what is|how'?s|how is)\s+(?:the\s+)?(?:weather|forecast)\b|^(?:the )?(?:weather|forecast)(?: today| now| outside)?$|^(?:will|is) it (?:going to )?rain|^(?:do i need|should i (?:bring|take)) (?:an? )?(?:umbrella|jacket|coat)|^how'?s it (?:looking )?outside|^is it (?:cold|hot|warm|nice) outside/i.test(s))
		return { intent: 'weather' };

	// before the brief: "what do I have tomorrow" must not read today's list
	if (/^(?:what'?s|whats|what is|what do i (?:have|need to do)|what have i got|what'?s on|what is on|read me)\b.*\btomorrow\b|^tomorrow(?:'s)?(?: list| brief| schedule| agenda)?$/i.test(s))
		return { intent: 'tomorrow' };

	if (/^(what('?s| is)|whats)\s+(on the wall|waiting|next|up|left|due|today)\b|^what do i (have|need to do)\b|^(read|give) me the (list|brief|wall)\b|^brief(ing)?$/i.test(s))
		return { intent: 'brief' };

	if (/^(i'?m|i am|we'?re|we are)\s+(leaving|heading out|off|going)\b|^(leaving|heading out)( now)?$|^what do i need( to bring)?\b|^read me the board\b/i.test(s))
		return { intent: 'board' };

	if ((m = s.match(/^(?:i'?m |i am |i'?ve |we'?re )?(?:all )?(?:done|finished|did)(?: with)?\s+(.+)$/i))) return { intent: 'done', query: m[1] };
	if ((m = s.match(/^(?:mark|tick off|check off|cross off)\s+(.+?)(?:\s+(?:as\s+)?done)?$/i))) return { intent: 'done', query: m[1] };
	if ((m = s.match(/^(.+?)\s+(?:is|are)\s+(?:done|finished|sorted)$/i))) return { intent: 'done', query: m[1] };
	if (/^(i'?m |i am )?done$|^(that'?s |it'?s )?done$/i.test(s)) return { intent: 'done', query: '' };

	if ((m = s.match(/^snooze\s*(.*?)(?:\s+(?:for\s+)?(an?|half an|\d+)\s*(minutes?|mins?|hours?|hrs?|days?)|\s+(?:until|till|til)\s+tomorrow)?$/i))) {
		const minutes = m[2] ? minutesFrom(m[2], m[3]) : /tomorrow/i.test(s) ? 24 * 60 : 60;
		return { intent: 'snooze', query: m[1].trim(), minutes: minutes ?? 60 };
	}

	if ((m = s.match(/^(?:show|open|go to|switch to)\s+(?:me\s+)?(?:the\s+)?(clock|time|school|homework|agents|music|weather|radar)\b/i)))
		return { intent: 'show', view: VIEWS[m[1].toLowerCase()] };

	if (/^(pause|stop)( the)?( music| song| playback)?$/i.test(s)) return { intent: 'music', action: 'pause' };
	if (/^(play|resume|unpause)( the)?( music| song)?$/i.test(s)) return { intent: 'music', action: 'play' };
	if (/^(next|skip)( this)?( song| track)?$|^next$/i.test(s)) return { intent: 'music', action: 'next' };
	if (/^(previous|last|go back)( song| track)?$/i.test(s)) return { intent: 'music', action: 'previous' };

	if (/^(screen|display) off$|^turn (off )?the (screen|display)( off)?$|^good ?night$/i.test(s)) return { intent: 'screen', state: 'off' };
	if (/^(screen|display) on$|^turn (on )?the (screen|display)( on)?$|^wake( up)?$|^good morning$/i.test(s)) return { intent: 'screen', state: 'on' };

	if (/^(allow|approve|yes,? allow)( it| that)?$/i.test(s)) return { intent: 'approval', decision: 'allow' };
	if (/^(deny|reject|block|don'?t allow)( it| that)?$/i.test(s)) return { intent: 'approval', decision: 'deny' };

	return null;
}

function short(s, n = 34) {
	const t = String(s || '').replace(/\s+/g, ' ').trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * The "Wall menu" choices. ctx: { tasks (views, sorted), approvals, board,
 * nowPlaying, view, hdmi }. Each item: { id, label, ...what to do }.
 * Labels are unique, since Shortcuts hands the chosen label back.
 */
export function buildMenu(ctx = {}) {
	const items = [];
	const add = (item) => {
		if (!items.some((x) => x.label === item.label)) items.push(item);
	};

	// the shortcut handles this one itself: Dictate Text, then /api/tasks/say
	add({ id: 'dictate', label: DICTATE_LABEL, intent: 'dictate' });
	// an "oops" button for the last thing a voice command or the menu did
	if (ctx.undo) add({ id: 'undo', label: `Undo: ${short(ctx.undo, 30)}`, intent: 'undo' });

	const appr = (ctx.approvals || [])[0];
	if (appr) {
		const what = short(appr.detail || appr.title, 28);
		add({ id: `allow:${appr.id}`, label: `Allow: ${what}`, intent: 'approval', decision: 'allow', approvalId: appr.id });
		add({ id: `deny:${appr.id}`, label: `Deny: ${what}`, intent: 'approval', decision: 'deny', approvalId: appr.id });
	}

	if (ctx.board) {
		add({ id: 'board', label: 'Read me the board', intent: 'board' });
		if (ctx.board.taskId) add({ id: `leave:${ctx.board.taskId}`, label: `Leaving now (${short(ctx.board.title, 18)})`, intent: 'done', taskId: ctx.board.taskId });
	}

	const open = (ctx.tasks || []).filter((t) => ['overdue', 'due', 'today'].includes(t.status) && t.id !== ctx.board?.taskId);
	for (const t of open.slice(0, 3)) add({ id: `done:${t.id}`, label: `Done: ${short(t.title)}`, intent: 'done', taskId: t.id });
	const waiting = open.find((t) => t.status === 'overdue' || t.status === 'due');
	if (waiting) add({ id: `snooze:${waiting.id}`, label: `Snooze 1 h: ${short(waiting.title, 26)}`, intent: 'snooze', taskId: waiting.id, minutes: 60 });

	add({ id: 'brief', label: "What's waiting?", intent: 'brief' });
	add({ id: 'tomorrow', label: "What's tomorrow?", intent: 'tomorrow' });
	add({ id: 'weather', label: "What's the weather?", intent: 'weather' });

	const np = ctx.nowPlaying;
	if (np?.playing) {
		add({ id: 'pause', label: 'Pause music', intent: 'music', action: 'pause' });
		add({ id: 'next', label: 'Next song', intent: 'music', action: 'next' });
	} else if (np?.title) {
		add({ id: 'play', label: `Play ${short(np.title, 24)}`, intent: 'music', action: 'play' });
	}

	if (ctx.view !== 'weather') add({ id: 'show:weather', label: 'Show the weather', intent: 'show', view: 'weather' });
	if (ctx.view !== 'clock') add({ id: 'show:clock', label: 'Show the clock', intent: 'show', view: 'clock' });

	if (ctx.hdmi === 'off') add({ id: 'screen:on', label: 'Screen on', intent: 'screen', state: 'on' });
	else add({ id: 'screen:off', label: 'Screen off', intent: 'screen', state: 'off' });

	return items;
}

/** Find a menu item from what Shortcuts sent back (the label, or the id). */
export function findMenuItem(items, choice) {
	const c = String(choice ?? '').trim();
	if (!c) return null;
	return items.find((i) => i.label === c || i.id === c) ?? items.find((i) => i.label.toLowerCase() === c.toLowerCase()) ?? null;
}

/** The single best thing for one press. */
export function pickPress(ctx = {}) {
	if ((ctx.approvals || []).length) return { intent: 'approval-read' };
	if (ctx.board) return { intent: 'board', show: true };
	const waiting = (ctx.tasks || []).find((t) => t.status === 'overdue' || t.status === 'due');
	if (waiting) return { intent: 'done', taskId: waiting.id };
	return { intent: 'brief' };
}

/** "Leave in 6 minutes. Bring PE kit, lunch and an umbrella. First: feed the cat. Due: Physics lab report." */
export function speakBoard(board) {
	if (!board) return 'No departure coming up.';
	const parts = [board.minutes > 0 ? `Leave for ${board.title.toLowerCase()} in ${board.minutes} minute${board.minutes === 1 ? '' : 's'}.` : `Time to go to ${board.title.toLowerCase()}.`];
	const list = (status) => board.rows.filter((r) => r.status === status).map((r) => r.label);
	const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
	const bring = list('bring');
	const todo = list('do');
	const due = list('due');
	if (bring.length) parts.push(`Bring ${join(bring)}.`);
	if (todo.length) parts.push(`First: ${join(todo)}.`);
	if (due.length) parts.push(`Due today: ${join(due)}.`);
	if (!bring.length && !todo.length && !due.length) parts.push('Nothing to bring. Have a good one.');
	return parts.join(' ');
}

export function viewName(view) {
	return VIEW_NAMES[view] || view;
}

/* ---------- weather and tomorrow, out loud ---------- */

/** "3 PM", "7:40 AM": on the wall's clock, said the way people say it */
function sayClock(ms) {
	return wallClock(ms).replace(':00 ', ' ');
}

/** "It's 61 and partly cloudy. High of 78. Rain likely around 3:00 PM." */
export function speakWeather(w, now = Date.now()) {
	const cur = w?.current;
	const temp = Number(cur?.temp);
	if (!Number.isFinite(temp)) return "I couldn't get the weather right now.";
	const today = wallDayKey(now);
	const hours = (w.hourly || []).filter((h) => String(h.time).startsWith(today) || (Date.parse(h.time) >= now && Date.parse(h.time) <= now + 12 * 3600000));
	const parts = [`It's ${Math.round(temp)} degrees${cur.desc ? ` and ${String(cur.desc).toLowerCase()}` : ''}.`];
	const highs = hours.filter((h) => String(h.time).startsWith(today)).map((h) => Number(h.temp)).filter(Number.isFinite);
	if (highs.length) parts.push(`High of ${Math.round(Math.max(...highs))} today.`);
	const wet = hours.find((h) => Date.parse(h.time) >= now - 1800000 && Number(h.precipitation_probability) >= 50);
	const soon = Math.max(Number(w.prediction?.rain30min) || 0, Number(w.prediction?.rain60min) || 0);
	if (soon >= 0.35) parts.push('Rain is on the radar right now.');
	else if (wet) parts.push(`Rain likely around ${sayClock(Date.parse(wet.time))}.`);
	else parts.push('No rain expected.');
	const alert = (w.alerts || [])[0];
	if (alert?.event) parts.push(`Weather alert: ${alert.event}.`);
	return parts.join(' ');
}

function nextDayKey(key) {
	const d = new Date(`${key}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

/** "Tomorrow: Leave for school at 7:40 AM, Dentist at 3:00 PM and Physics lab report due." */
export function speakTomorrow(tasks, now = Date.now()) {
	const key = nextDayKey(wallDayKey(now));
	const items = (tasks || [])
		.filter((t) => t.status !== 'done' && t.nextDue && eventDayKey(t.nextDue) === key)
		.sort((a, b) => Date.parse(a.nextDue) - Date.parse(b.nextDue));
	if (!items.length) return 'Nothing on for tomorrow.';
	const say = (t) => (t.allDay ? (t.kind === 'homework' ? `${t.title} due` : t.title) : `${t.title} at ${sayClock(Date.parse(t.nextDue))}`);
	const shown = items.slice(0, 5).map(say);
	const more = items.length - shown.length;
	if (more) shown.push(`${more} more`);
	const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0];
	return `Tomorrow: ${list}.`;
}

/** The timers on the wall: alerts titled "Timer…" that haven't gone off. */
export function activeTimers(tasks, now = Date.now()) {
	return (tasks || []).filter((t) => t.kind === 'alert' && /^timer\b/i.test(t.title) && t.status !== 'done' && Date.parse(t.nextDue) > now);
}

export function speakTimersLeft(tasks, now = Date.now()) {
	const timers = activeTimers(tasks, now).sort((a, b) => Date.parse(a.nextDue) - Date.parse(b.nextDue));
	if (!timers.length) return 'No timers running.';
	const one = (t) => {
		const label = t.title.replace(/^timer:?\s*/i, '');
		return `${label ? `${label}: ` : ''}${speakDuration(Date.parse(t.nextDue) - now)} left`;
	};
	return `${timers.map(one).join('. ')}.`;
}
