// What the Today list shows: the chores and alerts waiting or due today on
// the wall's clock, and how to say when each one is. Shared by the Today
// list on the classic Clock page (TodayTasks.svelte) and the glass card
// (GlassClock.svelte); the tests are in tests/today-list.test.mjs.
import { eventDayKey, wallClock, wallDayKey } from './calendarItems.js';
import { DISPLAY_TZ } from './atmosphere.js';

/** Open items for today, in the order the server sent them (soonest first). */
export function todayOpen(tasks, nowMs) {
	const todayKey = wallDayKey(nowMs);
	return (tasks || []).filter(
		(t) => ['overdue', 'due', 'today'].includes(t.status) || (t.status === 'snoozed' && eventDayKey(t.snoozedUntil) === todayKey)
	);
}

export const taskClock = (iso) => wallClock(Date.parse(iso)).toLowerCase();

export function lateBy(iso, nowMs) {
	const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
	if (mins < 60) return `${mins} min late`;
	const h = Math.round(mins / 60);
	return h < 24 ? `${h} h late` : `${Math.round(h / 24)} d late`;
}

/** "1 h late", "9:39 am", "today", "snoozed to 4:00 pm". */
export function taskWhen(t, nowMs) {
	if (t.allDay) return t.status === 'due' ? 'today' : t.kind === 'homework' ? 'due today' : 'today';
	if (t.status === 'overdue' || t.status === 'due') return lateBy(t.nextDue, nowMs);
	if (t.status === 'snoozed') return `snoozed to ${taskClock(t.snoozedUntil)}`;
	return taskClock(t.nextDue);
}

/** "Fri 2:04 pm" for the next thing after today. */
export function nextWhen(t) {
	const day = new Date(t.nextDue).toLocaleDateString('en-US', { weekday: 'short', timeZone: DISPLAY_TZ });
	return t.allDay ? day : `${day} ${taskClock(t.nextDue)}`;
}

export const isLate = (t) => t.status === 'overdue' || t.status === 'due';
