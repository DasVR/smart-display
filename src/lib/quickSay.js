/**
 * Siri / Shortcuts glue for the task list: turn one spoken sentence into a
 * task, and turn tasks back into a sentence Siri can read out.
 *
 *   "remind me to leave for practice in 20 minutes"     -> alert, now + 20 min
 *   "take out the bins every monday and thursday at 6pm" -> weekly chore, Mon/Thu 18:00
 *   "call the dentist tomorrow"                         -> chore, tomorrow 09:00
 *   "meds every day at 8:30am"                          -> daily chore
 *
 * It only knows the handful of phrasings people actually say to a wall; it
 * doesn't try to be a full date parser. Anything it can't place in time
 * becomes a chore due now (alerts need a time, so those come back with an
 * error Siri can speak). Times are local to the server, which is the kiosk.
 *
 * No I/O: taskHub calls these, tests/quick-say.test.mjs pins them down.
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_RE = '(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SPEAK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_HOUR = 9;
const PARTS_OF_DAY = { morning: 8, afternoon: 15, evening: 18, tonight: 20, night: 20 };

function dayIndex(word) {
	const w = word.toLowerCase().slice(0, 3);
	return DAY_NAMES.findIndex((d) => d.startsWith(w));
}

/** 6pm, 6:30 pm, 18:00, 6 (no meridiem: 1-6 reads as pm, 7-11 as am). */
function parseClock(h, m, mer) {
	let hour = Number(h);
	const min = m ? Number(m) : 0;
	if (hour > 23 || min > 59) return null;
	if (mer) {
		const pm = mer.toLowerCase().startsWith('p');
		if (hour === 12) hour = pm ? 12 : 0;
		else if (pm) hour += 12;
	} else if (hour >= 1 && hour <= 6) {
		hour += 12;
	}
	return { hour, min };
}

function cut(state, re, fn) {
	const m = state.rest.match(re);
	if (!m) return false;
	if (fn(m) === false) return false;
	state.rest = (state.rest.slice(0, m.index) + ' ' + state.rest.slice(m.index + m[0].length)).replace(/\s+/g, ' ');
	return true;
}

function startOfDay(ms) {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d;
}

/**
 * Parse one sentence. Returns { task } ready for normalizeTask (title, kind,
 * at, repeat) or { error } in words Siri can say back.
 */
export function parseQuick(text, now = Date.now()) {
	const raw = spelledNumbers(String(text ?? '').replace(/\s+/g, ' ').trim());
	if (!raw) return { error: "I didn't hear anything to add.", code: 'empty' };

	const state = { rest: ` ${raw} ` };
	let kind = 'chore';

	// Who it's for: a reminder is an alert, anything else is a chore.
	cut(state, /^\s*(?:hey siri,?\s*)?(?:please\s+)?(remind me(?: to)?|alert me(?: to)?|alert|heads up(?: to)?|ping me(?: to)?|add (?:a |an )?(?:chore|job|task|to-?do)(?: to)?|chore:?|to-?do:?|i need to|i have to|i've got to|i gotta)\b/i, (m) => {
		if (/remind|alert|heads up|ping/i.test(m[1])) kind = 'alert';
	});

	let offsetMin = null;
	let day = null; // Date at local midnight
	let clock = null; // { hour, min }
	let repeat = null;
	let weekdays = null;
	let dayIsWeekday = false; // "thursday" said on a Thursday after the time means next week

	// "in 20 minutes", "in an hour", "in half an hour", "in 2 days"
	cut(state, /\bin (an?|half an|\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?)\b/i, (m) => {
		const n = m[1] === 'half an' ? 0.5 : /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
		const unit = m[2].toLowerCase();
		offsetMin = n * (unit.startsWith('d') ? 1440 : unit.startsWith('h') ? 60 : 1);
	});

	// Repeats.
	cut(state, /\bevery (other )?(weekday|weekend|day|night|morning|evening|week|month|hour)\b/i, (m) => {
		const unit = m[2].toLowerCase();
		const interval = m[1] ? 2 : 1;
		if (unit === 'weekday') (repeat = { freq: 'weekly', interval }), (weekdays = [1, 2, 3, 4, 5]);
		else if (unit === 'weekend') (repeat = { freq: 'weekly', interval }), (weekdays = [0, 6]);
		else if (unit === 'week') repeat = { freq: 'weekly', interval };
		else if (unit === 'month') repeat = { freq: 'monthly', interval };
		else if (unit === 'hour') repeat = { freq: 'hourly', interval };
		else {
			repeat = { freq: 'daily', interval };
			if (unit in PARTS_OF_DAY) clock = { hour: PARTS_OF_DAY[unit], min: 0 };
		}
	});
	cut(state, /\b(daily|nightly|weekly|monthly|hourly)\b/i, (m) => {
		const w = m[1].toLowerCase();
		repeat = { freq: w === 'nightly' ? 'daily' : w, interval: 1 };
		if (w === 'nightly' && !clock) clock = { hour: 20, min: 0 };
	});
	// "every monday and thursday", "every mon, wed, fri", "on tuesdays"
	cut(state, new RegExp(`\\b(?:every|on) (${DAY_RE}s?(?:(?:,\\s*|\\s+and\\s+|\\s*&\\s*|\\s+)${DAY_RE}s?)*)\\b`, 'i'), (m) => {
		const found = [...m[1].matchAll(new RegExp(DAY_RE, 'gi'))].map((x) => dayIndex(x[0])).filter((d) => d >= 0);
		const plural = /every/i.test(m[0]) || /s\b/i.test(m[1].trim());
		if (!found.length) return false;
		if (plural || found.length > 1) {
			repeat = { freq: 'weekly', interval: repeat?.freq === 'weekly' ? repeat.interval : 1 };
			weekdays = [...new Set(found)].sort((a, b) => a - b);
		} else {
			day = nextWeekday(found[0], now);
			dayIsWeekday = true;
		}
	});

	// Days.
	cut(state, /\b(today|tonight|tomorrow|tmrw|tmr)(?: (morning|afternoon|evening|night))?\b/i, (m) => {
		const w = m[1].toLowerCase();
		const base = startOfDay(now);
		if (w !== 'today' && w !== 'tonight') base.setDate(base.getDate() + 1);
		day = base;
		const part = w === 'tonight' ? 'tonight' : m[2]?.toLowerCase();
		if (part && !clock) clock = { hour: PARTS_OF_DAY[part], min: 0 };
	});
	cut(state, /\bthis (morning|afternoon|evening)\b/i, (m) => {
		day = startOfDay(now);
		if (!clock) clock = { hour: PARTS_OF_DAY[m[1].toLowerCase()], min: 0 };
	});
	if (!day && !weekdays) {
		cut(state, new RegExp(`\\b(?:on |this |next )?${DAY_RE}\\b`, 'i'), (m) => {
			const d = dayIndex(m[1]);
			if (d < 0) return false;
			day = nextWeekday(d, now, /next/i.test(m[0]));
			dayIsWeekday = true;
		});
	}
	// "oct 12", "october 12th", "on the 15th"
	cut(state, /\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => {
		const month = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
		const date = Number(m[2]);
		if (month < 0 || date < 1 || date > 31) return false;
		const d = startOfDay(now);
		d.setMonth(month, date);
		if (d.getTime() < startOfDay(now).getTime()) d.setFullYear(d.getFullYear() + 1);
		day = d;
	});
	cut(state, /\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b/i, (m) => {
		const date = Number(m[1]);
		if (date < 1 || date > 31) return false;
		const d = startOfDay(now);
		d.setDate(date);
		if (d.getTime() < startOfDay(now).getTime()) d.setMonth(d.getMonth() + 1, date);
		day = d;
		if (!repeat && /\bevery month\b/i.test(raw)) repeat = { freq: 'monthly', interval: 1 };
	});

	// Times.
	cut(state, /\b(?:at )?(noon|midday|midnight)\b/i, (m) => {
		clock = { hour: /midnight/i.test(m[1]) ? 0 : 12, min: 0 };
	});
	cut(state, /\b(?:at |by |@ ?)?(\d{1,2})(?::(\d{2}))? ?([ap]\.?m\.?)(?=\s|$|[,.!?])/i, (m) => {
		const c = parseClock(m[1], m[2], m[3].replace(/\./g, ''));
		if (!c) return false;
		clock = c;
	});
	cut(state, /\b(?:at|by|@) ?(\d{1,2})(?::(\d{2}))?\b/i, (m) => {
		const c = parseClock(m[1], m[2], null);
		if (!c) return false;
		clock = c;
	});
	cut(state, /\b(\d{1,2}):(\d{2})\b/, (m) => {
		const c = parseClock(m[1], m[2], Number(m[1]) > 12 ? null : undefined);
		if (!c) return false;
		clock = c;
	});
	cut(state, /\b(?:in the )?(morning|afternoon|evening)\b/i, (m) => {
		if (!clock) clock = { hour: PARTS_OF_DAY[m[1].toLowerCase()], min: 0 };
	});

	const title = tidyTitle(state.rest);
	if (!title) return { error: "I didn't catch what to add.", code: 'no-title', when: { offsetMin, day: Boolean(day), clock: Boolean(clock), repeat: Boolean(repeat || weekdays) } };

	// Work out the first occurrence.
	let at;
	if (offsetMin != null) {
		at = new Date(now + offsetMin * 60000);
	} else if (weekdays) {
		const t = clock ?? { hour: DEFAULT_HOUR, min: 0 };
		at = firstOnDays(weekdays, t, now);
	} else if (day || clock) {
		const d = day ? new Date(day) : startOfDay(now);
		const t = clock ?? { hour: DEFAULT_HOUR, min: 0 };
		d.setHours(t.hour, t.min, 0, 0);
		// "at 6pm" with no day, already past: tomorrow. A daily rule rolls the same way.
		if (!day && d.getTime() <= now) d.setDate(d.getDate() + 1);
		else if (dayIsWeekday && d.getTime() <= now) d.setDate(d.getDate() + 7);
		at = d;
	} else if (repeat) {
		at = new Date(now);
	} else if (kind === 'alert') {
		return { error: `When should I remind you to ${lowerFirst(title)}?`, code: 'no-time', title };
	} else {
		at = new Date(now);
	}

	if (repeat && weekdays) repeat.days = weekdays;
	const task = { title, kind, at: at.toISOString() };
	if (repeat) task.repeat = repeat;
	return { task };
}

/* ---------- spelled-out numbers ---------- */

const SMALL = {
	one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
	eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
	eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90
};
const NUM_WORD = `(?:${Object.keys(SMALL).join('|')})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?`;
const UNIT = '(?:minutes?|mins?|hours?|hrs?|days?|weeks?)';

function wordToNumber(w) {
	const parts = w.toLowerCase().split(/[- ]/);
	return parts.reduce((n, p) => n + (SMALL[p] ?? 0), 0);
}

/**
 * Siri often writes small numbers as words ("in two minutes", "at five
 * thirty"). Turn the ones next to a time into digits, and leave the rest of
 * the sentence alone so "take one pill" stays a title.
 */
export function spelledNumbers(text) {
	let s = text;
	// "a couple of minutes", "a few minutes"
	s = s.replace(/\ba couple(?: of)?\s+(?=(minutes?|mins?|hours?|days?)\b)/gi, '2 ');
	s = s.replace(/\ba few\s+(?=(minutes?|mins?|hours?|days?)\b)/gi, '3 ');
	// "two minutes", "twenty-five minutes"
	s = s.replace(new RegExp(`\\b(${NUM_WORD})\\s+(?=${UNIT}\\b)`, 'gi'), (_, w) => `${wordToNumber(w)} `);
	// "five thirty pm", "six fifteen", "seven o'clock", "at nine", "nine am"
	s = s.replace(
		new RegExp(`\\b(at|by|around)\\s+(${NUM_WORD})(?:\\s+(fifteen|thirty|forty[- ]five|o'?clock))?(?=\\s|$|[,.!?])`, 'gi'),
		(_, pre, h, m) => `${pre} ${wordToNumber(h)}${m && !/clock/i.test(m) ? `:${String(wordToNumber(m)).padStart(2, '0')}` : ''}`
	);
	s = s.replace(
		new RegExp(`\\b(${NUM_WORD})(?:\\s+(fifteen|thirty|forty[- ]five))?\\s*(a\\.?m\\.?|p\\.?m\\.?)(?=\\s|$|[,.!?])`, 'gi'),
		(_, h, m, mer) => `${wordToNumber(h)}${m ? `:${String(wordToNumber(m)).padStart(2, '0')}` : ''}${mer}`
	);
	return s;
}

function nextWeekday(target, now, skipThisWeek = false) {
	const d = startOfDay(now);
	let diff = (target - d.getDay() + 7) % 7;
	// "next friday" said on a Friday means a week out; on any other day it
	// means the coming one, which is how people use it out loud
	if (skipThisWeek && diff === 0) diff = 7;
	d.setDate(d.getDate() + diff);
	return d;
}

function firstOnDays(days, clock, now) {
	const d = startOfDay(now);
	for (let i = 0; i < 8; i++) {
		if (days.includes(d.getDay())) {
			const c = new Date(d);
			c.setHours(clock.hour, clock.min, 0, 0);
			if (c.getTime() > now) return c;
		}
		d.setDate(d.getDate() + 1);
	}
	return d;
}

function tidyTitle(rest) {
	let t = rest.replace(/\s+/g, ' ').trim();
	// connectors stranded at the edges once the time words are gone
	const edge = /^(?:to|on|at|by|and|the|for|then|,|-)\s+|\s+(?:to|on|at|by|and|for|then|please|,|-)$/i;
	for (let i = 0; i < 6 && edge.test(t); i++) t = t.replace(edge, '').trim();
	t = t.replace(/[\s,.;:!?-]+$/, '').replace(/^[\s,.;:-]+/, '');
	return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function lowerFirst(s) {
	return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/* ---------- speaking ---------- */

/** "at 6 PM", "at 6:30 PM", "at noon" */
function speakClock(d) {
	const h = d.getHours();
	const m = d.getMinutes();
	if (h === 12 && m === 0) return 'at noon';
	if (h === 0 && m === 0) return 'at midnight';
	const h12 = h % 12 || 12;
	return `at ${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "in 20 minutes", "today at 6 PM", "tomorrow at 9 AM", "Thursday at 6 PM", "October 12 at 9 AM" */
export function speakWhen(iso, now = Date.now()) {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return '';
	const mins = Math.round((ms - now) / 60000);
	if (mins <= 0 && mins > -2) return 'now';
	if (mins > 0 && mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
	const d = new Date(ms);
	const days = Math.round((startOfDay(ms).getTime() - startOfDay(now).getTime()) / 86400000);
	let dayWord;
	if (days === 0) dayWord = 'today';
	else if (days === 1) dayWord = 'tomorrow';
	else if (days === -1) dayWord = 'yesterday';
	else if (days > 1 && days < 7) dayWord = SPEAK_DAYS[d.getDay()];
	else dayWord = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
	return `${dayWord} ${speakClock(d)}`;
}

function speakRepeat(task) {
	const r = task.repeat;
	if (!r) return '';
	const n = r.interval || 1;
	if (r.freq === 'weekly' && r.days?.length) {
		const key = r.days.join(',');
		if (key === '1,2,3,4,5') return n === 1 ? ', every weekday' : `, every ${n} weeks on weekdays`;
		if (key === '0,6') return ', every weekend';
		const names = r.days.map((x) => SPEAK_DAYS[x]);
		const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
		return n === 1 ? `, every ${list}` : `, every ${n} weeks on ${list}`;
	}
	const unit = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month' }[r.freq];
	return n === 1 ? `, every ${unit}` : n === 2 ? `, every other ${unit}` : `, every ${n} ${unit}s`;
}

/** What Siri says after adding: "Added a chore: Take out the bins, Thursday at 6 PM, every Monday and Thursday." */
export function speakAdded(task, now = Date.now()) {
	const what = task.kind === 'alert' ? 'Reminder set' : 'Added a chore';
	const when = speakWhen(task.nextDue ?? task.at, now);
	return `${what}: ${task.title}${when && when !== 'now' ? `, ${when}` : ''}${speakRepeat(task)}.`;
}

function joinTitles(list) {
	const t = list.map((x) => x.title);
	if (t.length <= 1) return t[0] ?? '';
	return `${t.slice(0, -1).join(', ')} and ${t.at(-1)}`;
}

/**
 * The spoken brief. `tasks` are task views (with `status`), already sorted
 * most-urgent first. "2 things waiting: Take out the bins and Feed the cat.
 * Later today: Meds at 8 PM. Next up: Dentist, Saturday at 9 AM."
 */
export function speakBrief(tasks, now = Date.now()) {
	const waiting = tasks.filter((t) => t.status === 'overdue' || t.status === 'due');
	const today = tasks.filter((t) => t.status === 'today');
	const upcoming = tasks.find((t) => t.status === 'upcoming');
	const parts = [];
	if (waiting.length) {
		const shown = waiting.slice(0, 4);
		const more = waiting.length - shown.length;
		parts.push(
			`${waiting.length === 1 ? 'One thing' : `${waiting.length} things`} waiting: ${joinTitles(shown)}${more ? `, and ${more} more` : ''}.`
		);
	} else {
		parts.push('Nothing waiting.');
	}
	if (today.length) {
		const shown = today.slice(0, 3).map((t) => (t.allDay ? t.title : `${t.title} ${speakClock(new Date(t.nextDue))}`));
		parts.push(`Later today: ${shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0]}.`);
	}
	if (upcoming && !today.length) {
		const when = speakWhen(upcoming.nextDue, now);
		parts.push(`Next up: ${upcoming.title}, ${upcoming.allDay ? when.replace(/ at .*$/, '') : when}.`);
	}
	return parts.join(' ');
}

/** After the Action button marks the top item done. */
export function speakDone(task, remaining, now = Date.now()) {
	const left = remaining === 0 ? 'Nothing else waiting.' : `${remaining} more waiting.`;
	const next = task.active && task.repeat ? ` Next time: ${speakWhen(task.nextDue, now)}.` : '';
	return `Done: ${task.title}.${next} ${left}`;
}

/** The item the Action button means: the most urgent one that's already waiting or due today. */
export function pickNext(views) {
	return views.find((t) => t.status === 'overdue' || t.status === 'due') ?? views.find((t) => t.status === 'today') ?? null;
}
