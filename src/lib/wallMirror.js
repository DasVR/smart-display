/**
 * The phone as the back of the wall: whatever view the wall shows, the
 * phone's Now pane shows the same thing in a few lines, with that view's
 * controls under it. Look at the wall, and the phone already has the
 * buttons for it.
 *
 * mirrorFor({ view, ledger, nowPlaying, weather, now }) returns
 *   { view, title, rows: [{ id, text, sub, actions: [...] }], empty, controls: [...] }
 * where an action is one of
 *   { kind: 'ack', id, label }                 answer what's ringing
 *   { kind: 'task', op: 'done'|'snooze', id, label }
 *   { kind: 'approval', decision, id, label }
 *   { kind: 'player', action: 'previous'|'play-pause'|'next', label }
 *
 * Pure: src/lib/components/WallMirror.svelte renders it; tests/wall-mirror.test.mjs.
 */

import { DISPLAY_TZ } from './atmosphere.js';
import { kioskViewLabel } from './kioskViews.js';

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TZ, hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TZ, weekday: 'short' });

/** "4:30 PM", "Tomorrow 9 AM", "Sat 9 AM", on the wall's clock */
export function whenText(iso, now = Date.now(), allDay = false) {
	const t = Date.parse(iso ?? '');
	if (!Number.isFinite(t)) return '';
	const day = dayFmt.format(t);
	const today = dayFmt.format(now);
	const tomorrow = dayFmt.format(now + 86_400_000);
	const prefix = day === today ? '' : day === tomorrow ? 'Tomorrow' : weekdayFmt.format(t);
	if (allDay) return prefix || 'Today';
	const time = timeFmt.format(t).replace(':00', '');
	return prefix ? `${prefix} ${time}` : time;
}

function entryActions(e) {
	const out = [];
	for (const a of e.actions ?? []) {
		const taskId = e.id.startsWith('task:') ? e.id.slice(5) : '';
		if (a === 'ack' && e.calling) out.push({ kind: 'ack', id: e.calling.id, label: 'Got it' });
		else if (a === 'done' && taskId) out.push({ kind: 'task', op: 'done', id: taskId, label: 'Done' });
		else if (a === 'snooze' && taskId) out.push({ kind: 'task', op: 'snooze', id: taskId, label: 'Later' });
		else if ((a === 'allow' || a === 'deny') && e.id.startsWith('approval:')) {
			out.push({ kind: 'approval', decision: a, id: e.id.slice(9), label: a === 'allow' ? 'Allow' : 'Deny' });
		}
	}
	// "Done" makes "Got it" redundant on a ringing chore
	if (out.some((a) => a.kind === 'task' && a.op === 'done')) return out.filter((a) => a.kind !== 'ack');
	return out;
}

function row(e, now, sub) {
	return { id: e.id, text: e.kind === 'approval' ? `${e.source}: ${e.title}` : e.title, sub: sub ?? (whenText(e.at, now, e.allDay) || e.detail || ''), calling: Boolean(e.calling), actions: entryActions(e) };
}

/**
 * skipCalling: leave out what's ringing, when the phone already shows it
 * in its own attention card above the mirror (one fact, one place).
 */
export function mirrorFor({ view = 'clock', ledger = null, nowPlaying = null, weather = null, now = Date.now(), skipCalling = false } = {}) {
	const L = ledger ?? { now: [], soon: [], past: [] };
	const base = { view, title: kioskViewLabel(view) || 'Clock', rows: [], controls: [], empty: '' };

	if (view === 'music') {
		const np = nowPlaying;
		const live = np && np.title && !np.unavailable;
		return {
			...base,
			rows: live ? [{ id: 'track', text: np.title, sub: [np.artist, np.album].filter(Boolean).join(' · '), art: np.art || '', actions: [] }] : [],
			empty: live ? '' : 'Nothing is playing.',
			playing: Boolean(live && np.playing),
			controls: live
				? [
						{ kind: 'player', action: 'previous', label: 'Previous' },
						{ kind: 'player', action: 'play-pause', label: np.playing ? 'Pause' : 'Play' },
						{ kind: 'player', action: 'next', label: 'Next' }
					]
				: []
		};
	}

	if (view === 'agents') {
		const waiting = L.now.filter((e) => e.kind === 'approval');
		const runs = L.past.filter((e) => e.kind === 'agent').slice(0, 3);
		return {
			...base,
			rows: [...waiting.map((e) => row(e, now, e.detail || '')), ...runs.map((e) => ({ id: e.id, text: e.title, sub: whenText(e.at, now), actions: [] }))],
			empty: waiting.length || runs.length ? '' : 'No agent is waiting on you.'
		};
	}

	if (view === 'calendar') {
		const rows = L.soon.slice(0, 6).map((e) => row(e, now));
		return { ...base, rows, empty: rows.length ? '' : 'Nothing coming up in the next day and a half.' };
	}

	if (view === 'weather') {
		const alerts = [...L.now, ...L.soon].filter((e) => e.kind === 'warning' || e.kind === 'weather');
		const c = weather?.current;
		const head = c && c.temp !== '--' && c.temp != null ? [{ id: 'now', text: `${Math.round(Number(c.temp))}° ${c.desc ?? ''}`.trim(), sub: c.windSpeed != null && c.windSpeed !== '--' ? `Wind ${Math.round(Number(c.windSpeed))} mph` : '', actions: [] }] : [];
		const rows = [...head, ...alerts.map((e) => row(e, now, e.detail || ''))];
		return { ...base, rows, empty: rows.length ? '' : 'No weather alerts.' };
	}

	// clock: what needs you, then the next thing coming (just named; it isn't due yet)
	const needs = L.now
		.filter((e) => !(skipCalling && e.calling && e.kind !== 'approval'))
		.slice(0, 4)
		.map((e) => row(e, now));
	const next = L.soon.find((e) => e.kind !== 'weather');
	const rows = next ? [...needs, { ...row(next, now), text: `Next: ${next.title}`, actions: [] }] : needs;
	return { ...base, rows, empty: rows.length ? '' : 'Nothing needs you.' };
}
