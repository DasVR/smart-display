/**
 * What the Action button and "tell the wall" can do beyond adding things.
 *
 *  - pickPress(ctx): one press does the most useful thing right now.
 *      (the wall is ringing     -> actionHub answers that first: "got it")
 *      an agent is waiting      -> read the request out (never auto-allow)
 *      a departure is on        -> read the board, bring it up on the wall
 *      something's waiting      -> tick off the most urgent item
 *      otherwise                -> the brief
 *  - buildMenu(ctx): the "Wall menu" shortcut's choices, built from what's
 *    on the wall this second (Done: Feed the cat, Allow: git push, Pause
 *    music, Screen off…).
 *  - parseCommand(text): spoken commands for "tell the wall" ("I'm done
 *    with the bins", "snooze the cat for an hour", "show the weather",
 *    "pause the music", "turn it up", "I'm leaving"). Anything that isn't a
 *    command is left for quickSay to add as a chore or alert. The sentence is
 *    cleaned first (normalizeCommand), and chore names are matched forgivingly
 *    (matchTask, resolveTask). understand(text) is the dry run.
 *  Every phrasing is listed in docs/voice-commands.md.
 *
 * Pure: src/lib/server/actionHub.js runs the actions; tests/wall-actions.test.mjs.
 */

import { cleanSpeech, spelledNumbers, speakDuration } from './quickSay.js';
import { eventDayKey, wallClock, wallDayKey } from './calendarItems.js';
import { DISPLAY_TZ } from './atmosphere.js';
import { parsePlayRequest } from './musicRequest.js';

export const VIEWS = {
	clock: 'clock',
	time: 'clock',
	home: 'clock',
	calendar: 'calendar',
	schedule: 'calendar',
	school: 'calendar',
	homework: 'calendar',
	agent: 'agents',
	agents: 'agents',
	music: 'music',
	lyrics: 'music',
	weather: 'weather',
	forecast: 'weather',
	radar: 'weather'
};
const VIEW_NAMES = { clock: 'the clock', calendar: 'the calendar', agents: 'the agents', music: 'music', weather: 'the weather' };

/** The menu's first item: the shortcut dictates and sends it to /api/tasks/say. */
export const DICTATE_LABEL = 'Tell the wall';

const FILLER = new Set(['the', 'a', 'an', 'my', 'our', 'to', 'with', 'of', 'for', 'out', 'up', 'please']);

/** "bins" -> "bin", "dishes" -> "dish", "bikes" -> "bike", "vacuuming" -> "vacuum"; "bring" stays "bring" */
function stem(w) {
	if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
	if (w.length > 5 && w.endsWith('ing')) {
		const base = w.slice(0, -3);
		return /(.)\1$/.test(base) && base.length > 3 ? base.slice(0, -1) : base;
	}
	if (w.length > 3 && /(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
	if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
	return w;
}

function words(s) {
	return String(s || '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((w) => w && !FILLER.has(w))
		.map(stem);
}

/** Edit distance, bailing out early once it passes `max` */
function editDistance(a, b, max) {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let low = i;
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			low = Math.min(low, row[j]);
		}
		if (low > max) return max + 1;
		prev = row;
	}
	return prev[b.length];
}

/** Same word, allowing for what dictation does: one slipped letter in a
 *  long-enough word ("vaccum", "laundary"), or a word cut short. */
export function sameWord(a, b) {
	if (a === b) return true;
	const short = a.length < b.length ? a : b;
	const long = short === a ? b : a;
	if (short.length < 5) return false;
	if (long.startsWith(short)) return true;
	const max = long.length >= 9 ? 2 : 1;
	return editDistance(a, b, max) <= max;
}

/** Every task a spoken phrase could mean, best first: { task, score, raw }. */
function rankTasks(views, query) {
	const q = words(query);
	if (!q.length) return [];
	const rank = { overdue: 0, due: 0, today: 1, snoozed: 2, upcoming: 3, done: 9 };
	const out = [];
	for (const t of views || []) {
		if (t.status === 'done') continue;
		const tw = [...new Set(words(t.title))];
		const hits = q.filter((w) => tw.some((x) => sameWord(w, x))).length;
		if (!hits) continue;
		const raw = hits / q.length + hits / Math.max(1, tw.length);
		out.push({ task: t, raw, score: raw - (rank[t.status] ?? 5) * 0.01 });
	}
	return out.filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score);
}

/**
 * Find the task a spoken phrase means. Word overlap (forgiving of the odd
 * mis-heard letter), then urgency: "the bins" finds "Take out the bins";
 * "cat" finds "Feed the cat".
 */
export function matchTask(views, query) {
	return rankTasks(views, query)[0]?.task ?? null;
}

const ACTIONABLE = new Set(['overdue', 'due', 'today']);

/**
 * Like matchTask, but says when the phrase fits several tasks equally well
 * and nothing about their urgency settles it ("feed" with "Feed the cat"
 * and "Feed the fish" both due): { task } or { ambiguous: [titles] } or
 * { task: null }. Better to ask than to tick off the wrong chore.
 */
export function resolveTask(views, query) {
	const ranked = rankTasks(views, query);
	if (!ranked.length) return { task: null };
	const top = ranked[0];
	let tied = ranked.filter((x) => top.raw - x.raw < 0.02);
	if (tied.some((x) => ACTIONABLE.has(x.task.status))) tied = tied.filter((x) => ACTIONABLE.has(x.task.status));
	const titles = [...new Set(tied.map((x) => x.task.title))];
	if (titles.length > 1) return { task: null, ambiguous: titles.slice(0, 3) };
	return { task: tied[0].task };
}

function minutesFrom(n, unit) {
	const v = /^an?$/i.test(n) ? 1 : n === 'half an' ? 0.5 : Number(n);
	if (!Number.isFinite(v) || v <= 0) return null;
	return Math.round(v * (/^h/i.test(unit) ? 60 : /^d/i.test(unit) ? 1440 : 1));
}

/** What dictation tends to mishear, fixed before anything is matched. */
const HEARD_AS = [
	[/\bwhether\b(?! or\b)/g, 'weather'],
	[/\bcal[ae]nd[ae]rs?\b/g, 'calendar'],
	[/\bra+d[ae]r\b/g, 'radar'],
	[/\bagent['s]*\b(?= (?:view|screen|page)\b)/g, 'agents']
];

/**
 * The sentence as it will be matched: curly quotes and filler gone ("hey
 * wall, could you please pause the music for me" -> "pause the music"),
 * "tell the wall to …" unwrapped, a trailing "now" dropped, and the usual
 * mishearings put right. cleanSpeech does the shared part for every phrase.
 */
export function normalizeCommand(text) {
	let s = cleanSpeech(text);
	s = s.replace(/^(?:tell|ask) the wall (?:to |that |if )?/i, '');
	s = s.replace(/[,.\s]+(?:right now|now|thanks|thank you|please)$/i, '');
	for (const [re, to] of HEARD_AS) s = s.replace(re, to);
	return s.replace(/\s+/g, ' ').trim();
}

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "40", "forty", "forty five", "a hundred" -> number, or null */
function levelFrom(text) {
	const t = String(text).trim().toLowerCase();
	if (/^\d{1,3}$/.test(t)) return Number(t);
	if (/^(?:a |one )?hundred$/.test(t)) return 100;
	if (t === 'half') return 50;
	const [a, b, ...rest] = t.split(/[\s-]+/);
	if (rest.length) return null;
	if (a in TENS) return b === undefined ? TENS[a] : b in ONES && ONES[b] > 0 && ONES[b] < 10 ? TENS[a] + ONES[b] : null;
	return b === undefined && a in ONES ? ONES[a] : null;
}

const LEVEL = `(\\d{1,3}|[a-z]+(?:[\\s-][a-z]+)?)`;
const VOLUME_SET = new RegExp(`^(?:set |turn |put |make )?(?:the )?(?:volume|sound|music|it)(?: up| down)?(?: to| at) ${LEVEL}\\s*(?:%|percent)?$|^volume ${LEVEL}\\s*(?:%|percent)?$`, 'i');

const VOLUME_STEP = 0.1;
const VOLUME_BIG_STEP = 0.25;

/** 0.05 steps look the same as 0.05000000000000001 on a slider */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Where a spoken volume command lands. `current` is { volume (0..1.5),
 * muted }. Returns { volume } or { muted }. A voice command never goes past
 * 100%: the amplifier range above that is for the slider on purpose.
 */
export function volumeTarget(current, cmd) {
	const now = Number.isFinite(Number(current?.volume)) ? Number(current.volume) : 0.5;
	if (cmd.change === 'mute') return { muted: true };
	if (cmd.change === 'unmute') return { muted: false };
	if (cmd.change === 'set') return { volume: round2(Math.min(1, Math.max(0, cmd.level / 100))) };
	const step = cmd.big ? VOLUME_BIG_STEP : VOLUME_STEP;
	const next = cmd.change === 'up' ? Math.min(1, now + step) : Math.max(0, now - step);
	return { volume: round2(next) };
}

export function speakVolume(result) {
	if (result?.muted === true) return 'Muted.';
	if (!Number.isFinite(Number(result?.volume))) return 'Volume changed.';
	return `Volume ${Math.round(Number(result.volume) * 100)} percent.`;
}

const LOUDER = /^(?:(?:turn|crank|bring|pump|raise)\s+(?:it |that |the (?:volume|music|sound|speakers?) )?up(?: the (?:volume|music|sound))?|(?:turn up|raise|increase|boost) the (?:volume|music|sound)|(?:volume|sound) up|(?:make (?:it|that) )?louder|louder please)(?: a (bit|little|lot|notch))?$/i;
const QUIETER = /^(?:(?:turn|bring|take|lower|put)\s+(?:it |that |the (?:volume|music|sound|speakers?) )?down(?: the (?:volume|music|sound))?|(?:turn down|lower|decrease|reduce) the (?:volume|music|sound)|(?:volume|sound) down|(?:make (?:it|that) )?(?:quieter|softer|lower)|quieter please)(?: a (bit|little|lot|notch))?$/i;

/** What the voice can do, for "what can I say?" */
export const HELP_SAY =
	"Try: I'm done with the bins. Snooze the cat for an hour. Set a timer for ten minutes. What's the weather? What's tomorrow? Show the calendar. Pause the music. Volume up. What time is it? Or announce dinner is ready.";

/** "7:20 AM", said the way people say it, on the wall's clock */
export function speakNow(now = Date.now()) {
	return `It's ${sayClock(now)}.`;
}

export function speakToday(now = Date.now()) {
	const d = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: DISPLAY_TZ }).format(new Date(now));
	return `It's ${d}.`;
}

export function speakNowPlaying(np) {
	if (!np?.title) return 'Nothing is playing.';
	const by = np.artist && !/^unknown/i.test(np.artist) ? ` by ${np.artist}` : '';
	return `${np.playing === false ? 'Paused: ' : ''}${np.title}${by}.`;
}

/**
 * A spoken command, or null when the sentence is something to add.
 * Returns { intent, ... }.
 */
export function parseCommand(text) {
	const s = normalizeCommand(text);
	if (!s) return null;
	let m;

	// adding always wins: "remind me…", "add…", and a timer being set
	if (/^(remind|alert|ping|add|chore|to-?do|i need to|i have to|i've got to|i gotta)\b/i.test(s)) return null;

	if (/^(undo|undo (that|it|this)|scratch that|take that back|oops|that was (wrong|a mistake)|cancel that|never ?mind that)$/i.test(s)) return { intent: 'undo' };

	if (/^(?:help|what can (?:you|i) (?:do|say)|what (?:are|were) (?:the|your) commands|what commands (?:are there|do you (?:know|have)))$/i.test(s)) return { intent: 'help' };
	if (/^(?:repeat(?: that)?|say (?:that )?again|what did you say|come again|pardon)$/i.test(s)) return { intent: 'repeat' };

	// the wall says it out loud: "announce dinner is ready", "tell everyone we're leaving"
	if ((m = s.match(/^(?:announce|broadcast|tell everyone|tell everybody|say out loud|call out)(?: that)?[,:]?\s+(.+)$/i))) return { intent: 'announce', text: m[1] };

	if (/^(cancel|stop|clear|delete|kill|turn off)\s+(?:the |my |all )?(?:\w+ )?timers?$/i.test(s)) return { intent: 'cancel-timer' };
	if (/^how (?:long|much)\b.*\b(?:timer|left)\b|^(?:how much )?time (?:is )?(?:left|remaining)\b|^timers?$/i.test(s)) return { intent: 'timer-left' };

	if (/^what(?:'s| is)? (?:the )?time(?: is it)?(?: now| right now)?$|^what time is it(?: now)?$|^(?:tell me )?the time$|^time$/i.test(s)) return { intent: 'time' };
	if (/^what(?:'s| is)? (?:the )?(?:date|day)(?: today| is it)?$|^what day is it(?: today)?$|^(?:today'?s )?date$/i.test(s)) return { intent: 'date' };

	if (/^(?:what'?s|whats|what is|how'?s|how is)\s+(?:the\s+)?(?:weather|forecast)\b|^(?:the )?(?:weather|forecast)(?: today| now| outside)?$|^(?:will|is) it (?:going to )?rain|^(?:do i need|should i (?:bring|take)) (?:an? )?(?:umbrella|jacket|coat)|^how'?s it (?:looking )?outside|^is it (?:cold|hot|warm|nice) outside/i.test(s))
		return { intent: 'weather' };

	// before the brief: "what do I have tomorrow" must not read today's list
	if (/^(?:what'?s|whats|what is|what do i (?:have|need to do)|what have i got|what'?s on|what is on|read me)\b.*\btomorrow\b|^tomorrow(?:'s)?(?: list| brief| schedule| agenda)?$/i.test(s))
		return { intent: 'tomorrow' };

	if (/^(what('?s| is)|whats)\s+(on the wall|waiting|next|up|left|due|today)\b|^what do i (have|need to do)\b|^(read|give) me the (list|brief|wall)\b|^brief(ing)?$/i.test(s)) return { intent: 'brief' };

	if (/^(i'?m|i am|we'?re|we are)\s+(leaving|heading out|off|going)\b|^(leaving|heading out)( now)?$|^what do i need( to bring)?\b|^read me the board\b/i.test(s)) return { intent: 'board' };

	if (/^what(?:'s| is)? (?:this|that) (?:song|track|tune)|^what(?:'s| is)? (?:playing|this)(?: right now| now)?$|^what (?:song|track) is (?:this|that|playing|on)|^who(?:'s| is) (?:this|singing|playing|that)|^what am i listening to/i.test(s)) return { intent: 'now-playing' };

	if ((m = s.match(/^(?:i'?m |i am |i'?ve |i have |i |we'?re |we are |we'?ve |we have |we )?(?:all |just |now |already )?(?:done|finished|completed|did)(?: with)?\s+(.+)$/i))) return { intent: 'done', query: m[1] };
	if ((m = s.match(/^(?:mark|tick off|check off|cross off|tick|check)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished))?$/i))) return { intent: 'done', query: m[1] };
	if ((m = s.match(/^(.+?)\s+(?:is|are|was|were)\s+(?:all )?(?:done|finished|sorted|complete|completed)$/i))) return { intent: 'done', query: m[1] };
	if (/^(i'?m |i am )?(all )?done$|^(that'?s |it'?s )?done$/i.test(s)) return { intent: 'done', query: '' };

	if ((m = spelledNumbers(s).match(/^snooze\s*(.*?)(?:\s+(?:for\s+)?(an?|half an|\d+)\s*(minutes?|mins?|hours?|hrs?|days?)|\s+(?:until|till|til)\s+tomorrow)?$/i))) {
		const minutes = m[2] ? minutesFrom(m[2], m[3]) : /tomorrow/i.test(s) ? 24 * 60 : 60;
		return { intent: 'snooze', query: m[1].trim().replace(/^for$/i, ''), minutes: minutes ?? 60 };
	}

	if ((m = s.match(/^(?:show|open|go to|switch to|bring up|pull up|put up|put on|display|take me to)\s+(?:me\s+)?(?:the\s+)?(clock|time|home|calendar|schedule|school|homework|agents?|music|lyrics|weather|forecast|radar)\b/i)))
		return { intent: 'show', view: VIEWS[m[1].toLowerCase()] };

	// volume: "turn it up", "volume down a bit", "set the volume to 40", "mute"
	if ((m = s.match(VOLUME_SET))) {
		const level = levelFrom(m[1] ?? m[2]);
		if (level !== null) return { intent: 'volume', change: 'set', level: Math.min(100, level) };
	}
	if ((m = s.match(LOUDER))) return { intent: 'volume', change: 'up', ...(/lot/i.test(m[1] || '') ? { big: true } : {}) };
	if ((m = s.match(QUIETER))) return { intent: 'volume', change: 'down', ...(/lot/i.test(m[1] || '') ? { big: true } : {}) };
	if (/^(?:mute|silence)(?: the)?(?: wall| sound| music| volume| speakers?)?$|^shh+$/i.test(s)) return { intent: 'volume', change: 'mute' };
	if (/^un-?mute(?: the)?(?: wall| sound| music| volume| speakers?)?$|^(?:turn|put) the sound back on$/i.test(s)) return { intent: 'volume', change: 'unmute' };

	if (/^(pause|stop)( the)?( music| song| playback)?$/i.test(s)) return { intent: 'music', action: 'pause' };
	if (/^(play|resume|unpause|continue)( the)?( music| song| playback)?$/i.test(s)) return { intent: 'music', action: 'play' };
	// "play Bohemian Rhapsody", "put on some jazz": started on Apple Music (src/lib/musicRequest.js)
	const wanted = parsePlayRequest(s);
	if (wanted) return { intent: 'play-request', ...wanted };
	if (/^(next|skip)( this| the)?( song| track| one)?$|^next$/i.test(s)) return { intent: 'music', action: 'next' };
	if (/^(previous|last|go back)( song| track)?$/i.test(s)) return { intent: 'music', action: 'previous' };

	if (/^(screen|display) off$|^turn (off )?the (screen|display)( off)?$|^good ?night$/i.test(s)) return { intent: 'screen', state: 'off' };
	if (/^(screen|display) on$|^turn (on )?the (screen|display)( on)?$|^wake( up)?$|^good morning$/i.test(s)) return { intent: 'screen', state: 'on' };

	if (/^(allow|approve|yes,? allow)( it| that)?$/i.test(s)) return { intent: 'approval', decision: 'allow' };
	if (/^(deny|reject|block|don'?t allow)( it| that)?$/i.test(s)) return { intent: 'approval', decision: 'deny' };

	return null;
}

/**
 * What the wall made of a sentence, without doing anything: the normalized
 * text, the command it matched (or null), and what "tell the wall" would do
 * with it. For the dry-run endpoint and the docs' examples.
 */
export function understand(text) {
	const normalized = normalizeCommand(text);
	const command = parseCommand(text);
	return { text: String(text ?? ''), normalized, command, would: command ? 'run' : normalized ? 'add' : 'nothing' };
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

	// something is ringing on the wall: answering it comes first
	const calling = (ctx.attention || [])[0];
	if (calling) add({ id: 'ack', label: `Got it: ${short(calling.title, 28)}`, intent: 'ack' });
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
