/**
 * The day's log, and the end-of-day receipt built from it.
 *
 * Dashboards only ever look ahead. This keeps a small tally of what got done
 * today (chores ticked off, alerts that went off, songs played, agent runs,
 * approvals answered) so that when StandBy comes on at night the wall can
 * print a receipt for the day and fold it away.
 *
 * Pure: the server (src/lib/server/dayLogHub.js) feeds it events and saves
 * the result; tests/day-log.test.mjs pins it down.
 */

export const KEEP_DAYS = 7;
const MAX_ITEMS = 200;

/** Local calendar day, 'YYYY-MM-DD'. */
export function dayKey(ms = Date.now()) {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyDay() {
	return { chores: [], alerts: 0, tracks: [], agents: [], approvals: { allow: 0, deny: 0 } };
}

function clip(v, n = 80) {
	return String(v ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, n);
}

/**
 * Add one event. Types:
 *   chore    { title }            a chore marked done
 *   alert    { title }            an alert went off
 *   track    { title, artist }    a song started (repeats of the same song are ignored)
 *   agent    { source }           an agent finished a run
 *   approval { decision }         allow | deny answered from the wall or phone
 */
export function logEvent(log, type, payload = {}, now = Date.now()) {
	const days = { ...(log?.days || {}) };
	const key = dayKey(now);
	const day = { ...emptyDay(), ...(days[key] || {}) };
	const at = new Date(now).toISOString();

	if (type === 'chore' && payload.title) {
		day.chores = [...day.chores, { title: clip(payload.title), at }].slice(-MAX_ITEMS);
	} else if (type === 'alert') {
		day.alerts += 1;
	} else if (type === 'track' && payload.title) {
		const last = day.tracks.at(-1);
		const title = clip(payload.title);
		const artist = clip(payload.artist, 60);
		if (last && last.title === title && last.artist === artist) return log;
		day.tracks = [...day.tracks, { title, artist, at }].slice(-MAX_ITEMS);
	} else if (type === 'agent' && payload.source) {
		day.agents = [...day.agents, { source: clip(payload.source, 40), at }].slice(-MAX_ITEMS);
	} else if (type === 'approval' && (payload.decision === 'allow' || payload.decision === 'deny')) {
		day.approvals = { ...day.approvals, [payload.decision]: day.approvals[payload.decision] + 1 };
	} else {
		return log;
	}

	days[key] = day;
	// keep a week
	const keys = Object.keys(days).sort();
	for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
	return { days };
}

function countBy(list, key) {
	const m = new Map();
	for (const x of list) m.set(x[key], (m.get(x[key]) || 0) + 1);
	return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function shortTime(iso) {
	const d = new Date(iso);
	const h = d.getHours();
	const m = String(d.getMinutes()).padStart(2, '0');
	return `${h % 12 || 12}:${m}${h < 12 ? 'a' : 'p'}`;
}

/**
 * What the receipt prints: line items with quantities and the odd sub-line,
 * plus a sign-off that reacts to the day. `weather` is { high, low } if the
 * kiosk knows them.
 */
export function buildReceipt(log, { now = Date.now(), date = dayKey(now), weather = null } = {}) {
	const day = { ...emptyDay(), ...(log?.days?.[date] || {}) };
	const lines = [];

	lines.push({ label: 'Chores done', qty: day.chores.length });
	for (const c of day.chores.slice(-4)) lines.push({ sub: true, label: c.title, qty: shortTime(c.at) });
	if (day.chores.length > 4) lines.push({ sub: true, label: `+${day.chores.length - 4} more`, qty: '' });

	if (day.alerts) lines.push({ label: 'Alerts', qty: day.alerts });

	lines.push({ label: 'Songs played', qty: day.tracks.length });
	const topArtist = countBy(day.tracks.filter((t) => t.artist), 'artist')[0];
	if (topArtist && topArtist[1] > 1) lines.push({ sub: true, label: `Most: ${topArtist[0]}`, qty: `×${topArtist[1]}` });
	else if (day.tracks.length) lines.push({ sub: true, label: `Last: ${day.tracks.at(-1).title}`, qty: '' });

	const agents = countBy(day.agents, 'source');
	if (day.agents.length) {
		lines.push({ label: 'Agent runs', qty: day.agents.length });
		lines.push({ sub: true, label: agents.map(([s, n]) => `${s} ${n}`).join(' · '), qty: '' });
	}
	const answered = day.approvals.allow + day.approvals.deny;
	if (answered) lines.push({ label: 'Allowed / denied', qty: `${day.approvals.allow}/${day.approvals.deny}` });

	if (weather && Number.isFinite(weather.high) && Number.isFinite(weather.low)) {
		lines.push({ label: 'High / low', qty: `${Math.round(weather.high)}° / ${Math.round(weather.low)}°` });
	}

	const score = day.chores.length * 2 + day.agents.length + Math.min(10, day.tracks.length / 3) + answered;
	const signoff =
		score === 0 ? 'A quiet one. Rest up.' : score < 6 ? 'Steady day. Nicely done.' : score < 14 ? 'Busy day. Well earned.' : 'Huge day. Go to bed.';

	const d = new Date(`${date}T12:00:00`);
	return {
		date,
		dateText: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(),
		lines,
		total: day.chores.length + day.alerts + day.tracks.length + day.agents.length + answered,
		signoff,
		empty: score === 0 && !day.alerts
	};
}
