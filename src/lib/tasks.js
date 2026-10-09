/**
 * Chores, little jobs and alerts: the pure model behind /api/tasks.
 *
 * Two kinds:
 *  - `chore`: something to do (take the bins out, water the plants). It
 *    comes due, nags once on the island, stays "overdue" until someone marks
 *    it done, then moves to its next occurrence (or retires, if one-off).
 *  - `alert`: a timed heads-up (leave for practice, meds). It fires once at
 *    its time and moves on by itself; nobody has to tick it off.
 *
 * Schedules are anchored at `at` (an ISO time). `repeat` is optional:
 *   { freq: 'hourly' | 'daily' | 'weekly' | 'monthly', interval?: n, days?: [0-6] }
 * `days` only applies to weekly (0 = Sunday). Times are computed in the
 * server's local time zone, which is the kiosk's.
 *
 * No I/O here: the store (src/lib/server/taskStore.js) and the HTTP / WS
 * layers call these functions, and tests/tasks.test.mjs pins them down.
 */

export const KINDS = ['chore', 'alert'];
export const FREQS = ['hourly', 'daily', 'weekly', 'monthly'];
export const SEVERITIES = ['info', 'ok', 'warn', 'error'];

const MAX_TITLE = 120;
const MAX_NOTES = 500;
const MAX_SOURCE = 40;

function clampInt(v, lo, hi, dflt) {
	const n = Math.round(Number(v));
	if (!Number.isFinite(n)) return dflt;
	return Math.min(hi, Math.max(lo, n));
}

function cleanText(v, max) {
	return String(v ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

/** Validate a repeat rule; returns null for "no repeat" or { error }. */
export function normalizeRepeat(raw) {
	if (raw == null || raw === '' || raw === 'none') return null;
	const r = typeof raw === 'string' ? { freq: raw } : raw;
	if (!FREQS.includes(r.freq)) return { error: `repeat.freq must be one of ${FREQS.join(', ')}` };
	const out = { freq: r.freq, interval: clampInt(r.interval ?? 1, 1, 365, 1) };
	if (r.freq === 'weekly' && Array.isArray(r.days) && r.days.length) {
		// drop anything that isn't a weekday 0-6 rather than clamping it, so a
		// bad 9 from an API caller can't silently become Saturday
		const days = [
			...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
		].sort((a, b) => a - b);
		if (days.length) out.days = days;
	}
	return out;
}

/**
 * Turn an API payload into a clean task, or { error }. `existing` is the
 * stored task when patching, so missing fields keep their current values.
 */
export function normalizeTask(input = {}, { now = Date.now(), existing = null, id } = {}) {
	const base = existing ? { ...existing } : {};
	const has = (k) => Object.prototype.hasOwnProperty.call(input, k);

	const kind = has('kind') ? input.kind : (base.kind ?? 'chore');
	if (!KINDS.includes(kind)) return { error: `kind must be one of ${KINDS.join(', ')}` };

	const title = has('title') ? cleanText(input.title, MAX_TITLE) : base.title;
	if (!title) return { error: 'title is required' };

	const atRaw = has('at') ? input.at : (base.at ?? new Date(now).toISOString());
	const atMs = Date.parse(atRaw);
	if (!Number.isFinite(atMs)) return { error: 'at must be an ISO date-time' };

	let repeat = base.repeat ?? null;
	if (has('repeat')) {
		repeat = normalizeRepeat(input.repeat);
		if (repeat?.error) return { error: repeat.error };
	}

	const severity = has('severity') ? input.severity : (base.severity ?? (kind === 'alert' ? 'warn' : 'info'));
	if (!SEVERITIES.includes(severity)) return { error: `severity must be one of ${SEVERITIES.join(', ')}` };

	const task = {
		id: base.id ?? id,
		kind,
		title,
		notes: has('notes') ? cleanText(input.notes, MAX_NOTES) : (base.notes ?? ''),
		at: new Date(atMs).toISOString(),
		repeat,
		severity,
		source: has('source') ? cleanText(input.source, MAX_SOURCE) : (base.source ?? ''),
		active: has('active') ? Boolean(input.active) : (base.active ?? true),
		createdAt: base.createdAt ?? new Date(now).toISOString(),
		updatedAt: new Date(now).toISOString(),
		lastDoneAt: base.lastDoneAt ?? null,
		doneCount: base.doneCount ?? 0,
		snoozedUntil: base.snoozedUntil ?? null,
		notifiedFor: base.notifiedFor ?? null,
		nextDue: base.nextDue ?? null
	};
	// A new time or rule resets where the schedule stands.
	if (!existing || has('at') || has('repeat')) {
		// First occurrence on or after the start: for "Mon & Thu" starting on a
		// Friday that's the next Monday, not the Friday itself.
		task.nextDue = task.repeat ? nextOccurrence(task, atMs - 1) : task.at;
		task.notifiedFor = null;
		task.snoozedUntil = null;
		if (has('at') || has('repeat')) task.active = has('active') ? task.active : true;
	}
	return { task };
}

/** One step of a rule from a given occurrence. */
function step(date, repeat) {
	const d = new Date(date);
	const n = repeat.interval || 1;
	if (repeat.freq === 'hourly') d.setHours(d.getHours() + n);
	else if (repeat.freq === 'daily') d.setDate(d.getDate() + n);
	else if (repeat.freq === 'weekly') d.setDate(d.getDate() + 7 * n);
	else if (repeat.freq === 'monthly') {
		const day = d.getDate();
		d.setDate(1);
		d.setMonth(d.getMonth() + n);
		const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		d.setDate(Math.min(day, last));
	}
	return d;
}

/** Midnight (local) of the week containing `d`, Sunday first. */
function weekStart(d) {
	const w = new Date(d);
	w.setHours(0, 0, 0, 0);
	w.setDate(w.getDate() - w.getDay());
	return w;
}

/**
 * First occurrence strictly after `afterMs`, or null when a one-off rule
 * has nothing left. Weekly rules with `days` fire on each listed weekday at
 * the anchor's time of day, every `interval` weeks counted from the anchor.
 */
export function nextOccurrence(task, afterMs) {
	const anchor = new Date(task.at);
	if (!task.repeat) return anchor.getTime() > afterMs ? anchor.toISOString() : null;
	const r = task.repeat;

	if (r.freq === 'weekly' && r.days?.length) {
		const anchorWeek = weekStart(anchor).getTime();
		const from = new Date(Math.max(afterMs, anchor.getTime() - 1));
		const cursor = new Date(from);
		cursor.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
		if (cursor.getTime() <= afterMs) cursor.setDate(cursor.getDate() + 1);
		for (let i = 0; i < 7 * 53 * (r.interval || 1); i++) {
			const weeks = Math.round((weekStart(cursor).getTime() - anchorWeek) / (7 * 864e5));
			if (
				cursor.getTime() >= anchor.getTime() &&
				weeks % (r.interval || 1) === 0 &&
				r.days.includes(cursor.getDay()) &&
				cursor.getTime() > afterMs
			) {
				return cursor.toISOString();
			}
			cursor.setDate(cursor.getDate() + 1);
			cursor.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
		}
		return null;
	}

	let d = anchor;
	// Bounded walk; hourly over a long-idle box is the worst case.
	for (let i = 0; i < 200000 && d.getTime() <= afterMs; i++) d = step(d, r);
	return d.getTime() > afterMs ? d.toISOString() : null;
}

/** Where a task stands right now, for sorting and display. */
export function taskStatus(task, now = Date.now()) {
	if (!task.active || !task.nextDue) return 'done';
	const snoozed = task.snoozedUntil && Date.parse(task.snoozedUntil) > now;
	if (snoozed) return 'snoozed';
	const due = Date.parse(task.nextDue);
	if (due <= now) return task.kind === 'chore' ? 'overdue' : 'due';
	const endOfDay = new Date(now);
	endOfDay.setHours(23, 59, 59, 999);
	return due <= endOfDay.getTime() ? 'today' : 'upcoming';
}

/** Mark a chore done (or dismiss an alert): advance or retire it. */
export function completeTask(task, now = Date.now()) {
	// Doing it early (bins out at noon for a 6pm slot) uses up the current
	// occurrence, so look past whichever is later: now or the current due time.
	const due = task.nextDue ? Date.parse(task.nextDue) : now;
	const next = nextOccurrence(task, Math.max(now, due));
	return {
		...task,
		lastDoneAt: new Date(now).toISOString(),
		doneCount: (task.doneCount || 0) + 1,
		snoozedUntil: null,
		notifiedFor: null,
		nextDue: next,
		active: Boolean(next),
		updatedAt: new Date(now).toISOString()
	};
}

/** Push a task back by `minutes` without changing its rule. */
export function snoozeTask(task, minutes, now = Date.now()) {
	const mins = clampInt(minutes, 1, 7 * 24 * 60, 15);
	const until = new Date(now + mins * 60000).toISOString();
	return { ...task, snoozedUntil: until, notifiedFor: null, updatedAt: new Date(now).toISOString() };
}

/**
 * The scheduler tick. Returns the updated task list plus the events to
 * announce: each task fires once per occurrence (`notifiedFor` remembers
 * which), snoozes hold it back, alerts roll on to their next time by
 * themselves, chores stay overdue until done.
 */
export function tickTasks(tasks, now = Date.now()) {
	const fired = [];
	const next = tasks.map((t) => {
		if (!t.active || !t.nextDue) return t;
		const snoozeEnd = t.snoozedUntil ? Date.parse(t.snoozedUntil) : 0;
		if (snoozeEnd > now) return t;
		const dueAt = Math.max(Date.parse(t.nextDue), snoozeEnd || 0);
		const key = `${t.nextDue}|${t.snoozedUntil ?? ''}`;
		if (dueAt > now || t.notifiedFor === key) return t;
		fired.push({ ...t });
		if (t.kind === 'alert') {
			const after = nextOccurrence(t, now);
			return {
				...t,
				nextDue: after,
				active: Boolean(after),
				snoozedUntil: null,
				notifiedFor: null,
				lastDoneAt: new Date(now).toISOString(),
				doneCount: (t.doneCount || 0) + 1
			};
		}
		return { ...t, notifiedFor: key };
	});
	return { tasks: next, fired };
}

const STATUS_ORDER = { overdue: 0, due: 0, today: 1, snoozed: 2, upcoming: 3, done: 4 };

/** Overdue first, then today, snoozed, upcoming, done; soonest first within each. */
export function sortTasks(tasks, now = Date.now()) {
	return [...tasks].sort((a, b) => {
		const sa = STATUS_ORDER[taskStatus(a, now)];
		const sb = STATUS_ORDER[taskStatus(b, now)];
		if (sa !== sb) return sa - sb;
		return (Date.parse(a.nextDue ?? a.at) || 0) - (Date.parse(b.nextDue ?? b.at) || 0);
	});
}

/** The island notification for a task that just came due. */
export function taskNotify(task) {
	const chore = task.kind === 'chore';
	return {
		title: cleanText(task.title, 120),
		body: task.notes ? cleanText(task.notes, 240) : chore ? 'Chore due now' : '',
		severity: task.severity || (chore ? 'info' : 'warn'),
		source: task.source || (chore ? 'Chores' : 'Alert'),
		kind: chore ? 'chore' : 'alert',
		ttl: chore ? 12000 : 15000
	};
}

/** Plain-language rule, e.g. "Every 2 weeks on Mon, Thu". */
export function describeRepeat(repeat) {
	if (!repeat) return 'Once';
	const n = repeat.interval || 1;
	const unit = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month' }[repeat.freq];
	let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
	if (repeat.freq === 'daily' && n === 1) text = 'Daily';
	if (repeat.freq === 'weekly' && repeat.days?.length) {
		const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const days = repeat.days.join(',');
		if (days === '1,2,3,4,5' && n === 1) return 'Weekdays';
		if (days === '0,6' && n === 1) return 'Weekends';
		text += ` on ${repeat.days.map((d) => names[d]).join(', ')}`;
	}
	return text;
}
