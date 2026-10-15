/**
 * The Ledger: the day as one timeline.
 *
 * Chores and alerts (taskHub), Google homework and reminders (calendarFeed,
 * via the task list), agents asking (approvalHub), NWS alerts (nwsWatch),
 * what's ringing (attentionHub) and what already happened (the day log) are
 * all entries on the same line, each with a tense:
 *
 *   now   needs you: ringing, overdue, due, an agent waiting, a warning out
 *   soon  coming up: later today and the next day
 *   past  done today: chores ticked off, songs played, agent runs
 *
 * One fact is one entry. A ringing chore is the chore, marked `calling`,
 * not a chore plus an attention item; the attention id rides along so
 * "got it" can answer it. Storage stays with each hub; this is the single
 * read model the wall and the phone show.
 *
 * Pure: src/lib/server/ledgerHub.js builds it as things change;
 * tests/ledger.test.mjs.
 */

const SOON_MS = 36 * 60 * 60 * 1000;
const PAST_MAX = 40;

const CALLING_FIRST = { warning: 0, severe: 0, approval: 1, timer: 2, reminder: 2, alert: 2, chore: 3 };

function clip(s, n) {
	const t = String(s ?? '').replace(/\s+/g, ' ').trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const ms = (iso) => (iso ? Date.parse(iso) : NaN);

function taskEntry(t, now) {
	const homework = t.external && /homework|#hw/i.test(`${t.title} ${t.notes ?? ''} ${t.source ?? ''}`);
	const kind = homework ? 'homework' : t.kind === 'alert' ? 'alert' : 'chore';
	const tense = t.status === 'overdue' || t.status === 'due' ? 'now' : t.status === 'today' || t.status === 'upcoming' ? 'soon' : null;
	if (!tense) return null;
	if (tense === 'soon' && ms(t.nextDue) - now > SOON_MS) return null;
	const actions = t.external ? ['done'] : t.kind === 'alert' ? ['done', 'snooze'] : ['done', 'snooze'];
	return {
		id: `task:${t.id}`,
		tense,
		kind,
		title: clip(t.title, 120),
		detail: clip(t.notes, 200),
		at: t.nextDue ?? null,
		allDay: Boolean(t.allDay),
		source: t.source || (t.external ? 'Google' : ''),
		status: t.status,
		actions
	};
}

function approvalEntry(a) {
	return {
		id: `approval:${a.id}`,
		tense: 'now',
		kind: 'approval',
		title: clip(a.title, 120),
		detail: clip(a.detail, 600),
		at: a.createdAt ?? null,
		until: a.expiresAt ?? null,
		source: a.source || 'Agent',
		status: 'waiting',
		actions: ['allow', 'deny']
	};
}

function weatherEntry(a, now) {
	const tier = a.tier || 'advisory';
	const until = a.ends || a.expires || null;
	if (until && ms(until) <= now) return null;
	return {
		id: `nws:${a.id}`,
		tense: tier === 'advisory' ? 'soon' : 'now',
		kind: tier === 'warning' ? 'warning' : 'weather',
		title: clip(a.event || 'Weather alert', 120),
		detail: clip(a.headline, 240),
		at: a.onset || a.sent || null,
		until,
		source: 'NWS',
		status: tier,
		actions: []
	};
}

/** What already happened today, newest first: chores, songs, agent runs. */
function pastEntries(day) {
	if (!day) return [];
	const out = [];
	for (const c of day.chores ?? []) out.push({ id: `done:${c.at}:${c.title}`, tense: 'past', kind: 'done', title: c.title, detail: '', at: c.at, source: '', status: 'done', actions: [] });
	for (const t of day.tracks ?? []) out.push({ id: `track:${t.at}`, tense: 'past', kind: 'track', title: t.title, detail: t.artist || '', at: t.at, source: '', status: 'played', actions: [] });
	for (const a of day.agents ?? []) out.push({ id: `agent:${a.at}:${a.source}`, tense: 'past', kind: 'agent', title: `${a.source} finished`, detail: '', at: a.at, source: a.source, status: 'done', actions: [] });
	return out.sort((x, y) => ms(y.at) - ms(x.at)).slice(0, PAST_MAX);
}

/**
 * Build the ledger.
 *   tasks      taskHub.snapshot() (views with status)
 *   approvals  approvalHub.snapshot() (pending)
 *   attention  attentionHub.snapshot() (what's ringing)
 *   alerts     nwsWatch.alerts()
 *   day        today's day-log record ({ chores, tracks, agents, ... })
 * Returns { now, soon, past, counts, at }.
 */
export function buildLedger({ tasks = [], approvals = [], attention = [], alerts = [], day = null, now = Date.now() } = {}) {
	const byId = new Map();
	for (const t of tasks) {
		const e = taskEntry(t, now);
		if (e) byId.set(e.id, e);
	}
	for (const a of approvals) {
		if (!a.status || a.status === 'pending') byId.set(`approval:${a.id}`, approvalEntry(a));
	}
	for (const a of alerts) {
		const e = weatherEntry(a, now);
		if (e) byId.set(e.id, e);
	}
	// what's ringing joins the fact it's about; anything else (a timer that
	// fired, a notify) is its own entry
	for (const i of attention) {
		const known = i.ref && byId.get(i.ref);
		if (known) {
			known.tense = 'now';
			known.calling = { id: i.id, kind: i.kind, since: i.raisedAt };
			if (!known.actions.includes('ack')) known.actions = ['ack', ...known.actions];
			continue;
		}
		const id = i.ref || `attention:${i.id}`;
		byId.set(id, {
			id,
			tense: 'now',
			kind: i.kind || 'alert',
			title: clip(i.title, 120),
			detail: clip(i.body, 240),
			at: i.raisedAt ?? null,
			source: '',
			status: 'ringing',
			calling: { id: i.id, kind: i.kind, since: i.raisedAt },
			actions: ['ack']
		});
	}

	const all = [...byId.values()];
	const nowList = all
		.filter((e) => e.tense === 'now')
		.sort((a, b) => {
			if (Boolean(b.calling) !== Boolean(a.calling)) return b.calling ? 1 : -1;
			const ka = CALLING_FIRST[a.kind] ?? 4;
			const kb = CALLING_FIRST[b.kind] ?? 4;
			if (ka !== kb) return ka - kb;
			return (ms(a.at) || 0) - (ms(b.at) || 0);
		});
	const soon = all.filter((e) => e.tense === 'soon').sort((a, b) => (ms(a.at) || Infinity) - (ms(b.at) || Infinity));
	const past = pastEntries(day);
	return {
		now: nowList,
		soon,
		past,
		counts: { now: nowList.length, calling: nowList.filter((e) => e.calling).length, soon: soon.length, past: past.length },
		at: new Date(now).toISOString()
	};
}

/** A short spoken or one-line summary: "2 need you: Feed the cat, Claude Code. 3 coming up." */
export function ledgerLine(ledger) {
	if (!ledger) return '';
	const parts = [];
	if (ledger.now.length) {
		const names = ledger.now.slice(0, 3).map((e) => (e.kind === 'approval' ? e.source : e.title));
		parts.push(`${ledger.now.length} need${ledger.now.length === 1 ? 's' : ''} you: ${names.join(', ')}${ledger.now.length > 3 ? '…' : ''}.`);
	}
	if (ledger.soon.length) parts.push(`${ledger.soon.length} coming up.`);
	if (!parts.length) parts.push('Nothing needs you.');
	return parts.join(' ');
}

/** Has anything a person would notice changed? Ignores the timestamp. */
export function sameLedger(a, b) {
	if (!a || !b) return false;
	const key = (l) => JSON.stringify([l.now, l.soon, l.past]);
	return key(a) === key(b);
}
