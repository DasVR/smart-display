/**
 * Google Calendar on the wall's task list.
 *
 * Two things come from your Google account and join the chores and alerts
 * (Today panel, phone, Siri, the Action button), read-only:
 *  - homework: calendar events that look like schoolwork (#hw, "due",
 *    "quiz", "essay"…), due at the event's time
 *  - reminders: Google Tasks (what Google Calendar shows as reminders and
 *    tasks), plus calendar events titled "Reminder…"
 *
 * Ticking one off on the wall only hides it there; Google isn't changed.
 *
 * Also home to the date fix: Google sends all-day items as a bare
 * 'YYYY-MM-DD', which `new Date()` reads as midnight UTC, the evening
 * *before* in the Americas. That's how tomorrow's homework ended up
 * labelled "Today". Always go through eventDate().
 *
 * Pure; src/lib/server/calendarFeed.js fetches. tests/calendar-items.test.mjs.
 */

import { DISPLAY_TZ } from './atmosphere.js';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' of an instant on the wall's clock (America/New_York), whatever the browser's zone. */
export function wallDayKey(ms, tz = DISPLAY_TZ) {
	return new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
}

/** The calendar day an event or due date falls on, on the wall's clock. */
export function eventDayKey(iso, tz = DISPLAY_TZ) {
	const s = String(iso || '');
	if (DATE_ONLY.test(s)) return s;
	const ms = Date.parse(s);
	return Number.isFinite(ms) ? wallDayKey(ms, tz) : '';
}

/** "7:40 PM" on the wall's clock. */
export function wallClock(ms, tz = DISPLAY_TZ) {
	return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
}

/** True for Google's all-day form, a bare 'YYYY-MM-DD'. */
export function isAllDay(iso) {
	return DATE_ONLY.test(String(iso || ''));
}

/** A Date for a calendar start/due: bare dates are local midnight, not UTC. */
export function eventDate(iso) {
	const m = DATE_ONLY.exec(String(iso || ''));
	if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return new Date(iso);
}

/** ms for sorting and comparing; NaN when unparseable. */
export function eventTime(iso) {
	return eventDate(iso).getTime();
}

const WORK = /\b(hw|homework|assignment|bookwork|worksheet|handout|project|presentation|powerpoint|quiz|test|exam|midterm|final|study|review|notes|replies|discussion|essay|paper|lab|report|due)\b/i;
const REMINDER = /^\s*(reminder|remind me|don'?t forget)\b[:\s-]*/i;

export function isHomework(e) {
	return /(^|\s)#hw(\s|$)/i.test(`${e.title || ''} ${e.description || ''}`) || WORK.test(`${e.title || ''} ${e.description || ''}`);
}

function endOfLocalDay(d) {
	const e = new Date(d);
	e.setHours(23, 59, 0, 0);
	return e;
}

function clean(s, n) {
	return String(s || '')
		.replace(/\s+/g, ' ')
		.replace(/(^|\s)#hw(\s|$)/gi, ' ')
		.trim()
		.slice(0, n);
}

/**
 * Turn calendar events and Google Tasks into wall items. They look like
 * tasks (so status, sorting, the brief and the menu all just work) with
 * `external: true`. All-day ones are due at 23:59 that day so they read as
 * "today" all day instead of "overdue" from midnight.
 */
export function calendarToItems({ events = [], gtasks = [] } = {}, { now = Date.now() } = {}) {
	const items = [];
	const startToday = new Date(now);
	startToday.setHours(0, 0, 0, 0);

	for (const e of events) {
		if (!e?.start) continue;
		const homework = isHomework(e);
		const reminder = REMINDER.test(e.title || '');
		if (!homework && !reminder) continue;
		const allDay = isAllDay(e.start);
		const at = eventDate(e.start);
		if (!Number.isFinite(at.getTime())) continue;
		// yesterday's (and older) items fall off; today's stay until dismissed
		if ((allDay ? at : endOfLocalDay(at)).getTime() < startToday.getTime()) continue;
		const subject = String(e.location || '').split('·')[0].replace(/#hw/i, '').trim();
		items.push({
			id: `gcal:${e.id}`,
			external: true,
			kind: homework ? 'homework' : 'reminder',
			title: clean(reminder ? (e.title || '').replace(REMINDER, '') : e.title, 120) || '(untitled)',
			notes: subject,
			nextDue: (allDay ? endOfLocalDay(at) : at).toISOString(),
			allDay,
			active: true,
			repeat: null,
			source: homework ? 'Homework' : 'Google Calendar'
		});
	}

	for (const t of gtasks) {
		if (!t?.id || t.status === 'completed' || !t.title) continue;
		// Google Tasks due dates are a calendar day sent as midnight UTC
		const day = t.due ? String(t.due).slice(0, 10) : null;
		const at = day ? eventDate(day) : null;
		if (at && at.getTime() < startToday.getTime() - 6 * 86400000) continue; // long-stale
		items.push({
			id: `gtask:${t.id}`,
			external: true,
			kind: 'reminder',
			title: clean(t.title, 120),
			notes: clean(t.notes, 200),
			// no due date: it's for "today", like an undated reminder in Calendar
			nextDue: endOfLocalDay(at ?? new Date(now)).toISOString(),
			allDay: true,
			active: true,
			repeat: null,
			source: t.listTitle ? clean(t.listTitle, 40) : 'Google Tasks'
		});
	}
	return items;
}
