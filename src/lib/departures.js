/**
 * The departure board: in the hour before you leave, the Clock view turns
 * into an airport board that answers the one question you have at the door.
 *
 * There's nothing to configure. Any chore or alert whose title starts with
 * "Leave" ("Leave for school", weekdays 7:40; "Leave for practice") is a
 * departure. From LEAD_MIN before it until a few minutes after, the board
 * shows a countdown plus rows built from what the display already knows:
 *
 *  - the departure's own notes, split on commas ("PE kit, lunch")   BRING
 *  - rain on the way while you're out                              BRING umbrella
 *  - a cold low or a hot high                                       BRING jacket / water
 *  - chores due before you leave                                    DO
 *  - homework (#hw calendar events) due today                       DUE
 *
 * Pure: the page feeds it state once a second. tests/departures.test.mjs.
 */
import { taskStatus } from './tasks.js';
import { eventDayKey, isAllDay, wallClock, wallDayKey } from './calendarItems.js';

export const LEAD_MIN = 60;
/** keep "Go now" up this long after the time, so it doesn't vanish mid-shoe */
export const GRACE_MIN = 5;

const LEAVE_RE = /^\s*(leave|head out|depart)\b/i;
const OUT_HOURS = 10;

export function isDeparture(task) {
	return Boolean(task && LEAVE_RE.test(task.title || ''));
}

/** "Leave for school" -> "School", "Leave" -> "Out" */
export function destination(title) {
	const rest = String(title || '')
		.replace(LEAVE_RE, '')
		.replace(/^\s*(for|to|the house for)\s+/i, '')
		.trim();
	return rest ? rest[0].toUpperCase() + rest.slice(1) : 'Out';
}

/** The departure that's on now, if any: { task, leaveAt } */
export function currentDeparture(tasks, now = Date.now()) {
	let best = null;
	for (const t of tasks || []) {
		if (!isDeparture(t)) continue;
		const candidates = [];
		if (t.active && t.nextDue) candidates.push(Date.parse(t.nextDue));
		// an alert rolls on to tomorrow the moment it fires; lastDoneAt is
		// when "now" was, so the grace window still finds it
		if (t.kind === 'alert' && t.lastDoneAt) candidates.push(Date.parse(t.lastDoneAt));
		if (t.snoozedUntil) candidates.push(Date.parse(t.snoozedUntil));
		for (const at of candidates) {
			if (!Number.isFinite(at)) continue;
			if (at - now > LEAD_MIN * 60000 || now - at > GRACE_MIN * 60000) continue;
			if (!best || at < best.leaveAt) best = { task: t, leaveAt: at };
		}
	}
	return best;
}

function clock(ms) {
	// on the wall's clock, whatever time zone the browser thinks it's in
	return wallClock(ms).replace(/\s/g, '\u2009');
}

function hourlyWindow(weather, from, to) {
	const out = [];
	for (const h of weather?.hourly || []) {
		const at = Date.parse(h.time);
		if (Number.isFinite(at) && at >= from - 3600000 && at <= to) out.push({ ...h, at });
	}
	return out;
}

/** Weather rows for the hours you'll be out. Temps in the feed's unit (°F here). */
export function weatherRows(weather, leaveAt) {
	const rows = [];
	const hours = hourlyWindow(weather, leaveAt, leaveAt + OUT_HOURS * 3600000);
	const pred = weather?.prediction || {};

	let wet = null;
	for (const h of hours) {
		const pop = Number(h.precipitation_probability) || 0;
		if (pop >= 40 && (!wet || pop > wet.pop)) wet = { pop, at: h.at };
	}
	const soon = Math.max(Number(pred.rain30min) || 0, Number(pred.rain60min) || 0);
	if (soon >= 0.35) rows.push({ id: 'umbrella', status: 'bring', label: 'Umbrella', detail: 'Rain on the radar now' });
	else if (wet) rows.push({ id: 'umbrella', status: 'bring', label: 'Umbrella', detail: `Rain ${Math.round(wet.pop)}% around ${clock(wet.at)}` });

	const temps = hours.map((h) => Number(h.temp)).filter(Number.isFinite);
	if (temps.length) {
		const lo = Math.min(...temps);
		const hi = Math.max(...temps);
		if (lo <= 50) rows.push({ id: 'jacket', status: 'bring', label: lo <= 35 ? 'Warm coat' : 'Jacket', detail: `Low ${Math.round(lo)}°` });
		if (hi >= 86) rows.push({ id: 'water', status: 'bring', label: 'Water bottle', detail: `High ${Math.round(hi)}°` });
	}
	const uv = Number(weather?.sun?.uvMax);
	if (uv >= 7) rows.push({ id: 'sunscreen', status: 'bring', label: 'Sunscreen', detail: `UV ${Math.round(uv)}` });
	return rows;
}

/**
 * Everything the board shows, or null when no departure is on.
 * `tasks` are task views (or raw tasks), `events` the calendar feed.
 */
export function departureBoard({ tasks = [], events = [], weather = null, now = Date.now() } = {}) {
	const dep = currentDeparture(tasks, now);
	if (!dep) return null;
	const { task, leaveAt } = dep;
	const minutes = Math.ceil((leaveAt - now) / 60000);
	const phase = minutes <= 0 ? 'go' : minutes <= 5 ? 'final' : minutes <= 15 ? 'boarding' : 'ontime';

	const rows = [];
	for (const [i, item] of (task.notes || '').split(/[,;\n]+/).entries()) {
		const label = item.trim();
		if (label) rows.push({ id: `note${i}`, status: 'bring', label: label[0].toUpperCase() + label.slice(1), detail: '' });
	}
	rows.push(...weatherRows(weather, leaveAt));

	for (const t of tasks) {
		if (t === task || t.id === task.id || t.kind !== 'chore' || isDeparture(t)) continue;
		const status = taskStatus(t, now);
		const due = Date.parse(t.nextDue);
		if (status === 'overdue' || (status === 'today' && due <= leaveAt)) {
			rows.push({ id: `task-${t.id}`, taskId: t.id, status: 'do', label: t.title, detail: status === 'overdue' ? 'Waiting' : `Before ${clock(leaveAt)}` });
		}
	}

	// homework due today on the wall's clock (all-day items are bare dates)
	const today = wallDayKey(now);
	for (const e of events || []) {
		if (!e?.start || eventDayKey(e.start) !== today) continue;
		const allDay = isAllDay(e.start);
		const at = Date.parse(e.start);
		if (!allDay && at < now - 3600000) continue;
		const subject = String(e.location || '').split('·')[0].trim();
		const when = allDay ? 'today' : clock(at);
		rows.push({ id: `hw-${e.id ?? e.title}`, status: 'due', label: e.title, detail: subject ? `${subject} · ${when}` : when });
	}

	return {
		taskId: task.id,
		title: destination(task.title),
		leaveAt,
		leaveText: clock(leaveAt),
		minutes,
		phase,
		rows: rows.slice(0, 7),
		more: Math.max(0, rows.length - 7)
	};
}
