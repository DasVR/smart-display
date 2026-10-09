/**
 * Polls Google Calendar (homework, "Reminder…" events) and Google Tasks
 * every few minutes and hands the result to the task hub as read-only items
 * (src/lib/calendarItems.js). Failures keep the last good list, so a
 * network blip doesn't empty the wall.
 */
import { calendarToItems } from '../calendarItems.js';

const POLL_MS = 10 * 60000;

export function createCalendarFeed({ loadEvents, loadGoogleTasks, onChange, log = console, now = () => Date.now() }) {
	let events = [];
	let gtasks = [];
	let timer = 0;
	let warnedScope = false;
	let lastKey = '';

	function items() {
		return calendarToItems({ events, gtasks }, { now: now() });
	}

	async function refresh() {
		const [ev, gt] = await Promise.allSettled([loadEvents(), loadGoogleTasks()]);
		if (ev.status === 'fulfilled' && Array.isArray(ev.value)) events = ev.value;
		if (gt.status === 'fulfilled') {
			if (gt.value?.scope === false && !warnedScope) {
				warnedScope = true;
				log.warn?.('calendar: Google Tasks skipped; the Google token lacks the tasks.readonly scope (calendar events still show)');
			}
			if (Array.isArray(gt.value?.tasks)) gtasks = gt.value.tasks;
		}
		const key = JSON.stringify(items().map((i) => [i.id, i.title, i.nextDue]));
		if (key !== lastKey) {
			lastKey = key;
			onChange?.();
		}
	}

	function start() {
		refresh().catch(() => {});
		timer = setInterval(() => refresh().catch(() => {}), POLL_MS);
	}
	function stop() {
		clearInterval(timer);
	}

	return { items, refresh, start, stop };
}
