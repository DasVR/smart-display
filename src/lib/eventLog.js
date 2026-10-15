/**
 * The wall's day as a recording.
 *
 * Everything the server broadcasts is one line in data/log/YYYY-MM-DD.ndjson:
 *   {"t": 1760536800000, "m": { "type": "tasks", ... }}
 * plus a keyframe (a full `init`) when the server starts and every hour, so
 * playback can start anywhere. A recorded day replays on a real wall build
 * (scripts/replay-day.mjs), which makes it a demo, a test fixture and a bug
 * report at once.
 *
 * What is never written: pairing codes and devices, what the microphone
 * heard, transcripts and notes, spoken clip URLs, audio frames and the
 * once-a-second load and playback ticks. Long text is cut short.
 *
 * Pure: src/lib/server/eventLog.js writes files; tests/event-log.test.mjs.
 */

/** Never recorded at all. */
const DROP = new Set(['audioSpectrum', 'load', 'ping', 'pong', 'pair-code', 'pair-code-clear', 'paired', 'pairing', 'hello']);
/** Recorded as the event only: the words stay out. */
const WORDS = new Set(['heard', 'transcript', 'listening', 'speak']);
const TEXT_MAX = 400;

function trimDeep(v, depth = 0) {
	if (typeof v === 'string') return v.length > TEXT_MAX ? `${v.slice(0, TEXT_MAX - 1)}…` : v;
	if (Array.isArray(v)) return depth > 6 ? [] : v.slice(0, 200).map((x) => trimDeep(x, depth + 1));
	if (v && typeof v === 'object') {
		if (depth > 6) return {};
		const out = {};
		for (const [k, x] of Object.entries(v)) out[k] = trimDeep(x, depth + 1);
		return out;
	}
	return v;
}

/** The message as it should be stored, or null to skip it. */
export function redact(msg) {
	if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
	if (DROP.has(msg.type)) return null;
	// playback position ticks: only track changes, starts and stops are worth keeping
	if (msg.type === 'nowPlaying' && (msg.kind === 'update' || msg.kind === 'tick' || msg.kind === 'position')) return null;
	if (WORDS.has(msg.type)) {
		const { type, on, kind, source, from } = msg;
		return Object.fromEntries(Object.entries({ type, on, kind, source, from }).filter(([, v]) => v !== undefined));
	}
	const out = { ...msg };
	delete out.lyrics; // big, and it's on disk already in the lyrics store
	delete out.pairing;
	delete out.device;
	if (out.senses) out.senses = { presence: out.senses.presence, online: out.senses.online };
	if (out.notes && typeof out.notes === 'object') out.notes = { on: Boolean(out.notes.on), count: out.notes.count ?? 0 };
	return trimDeep(out);
}

/** One line for the file, or '' when the message isn't recorded. */
export function logLine(msg, at = Date.now()) {
	const m = redact(msg);
	return m ? `${JSON.stringify({ t: at, m })}\n` : '';
}

/** Read a day's file back: [{ t, m }] in time order; bad lines are skipped. */
export function parseLog(text) {
	const out = [];
	for (const line of String(text ?? '').split('\n')) {
		if (!line.trim()) continue;
		try {
			const e = JSON.parse(line);
			if (Number.isFinite(e?.t) && e.m?.type) out.push({ t: e.t, m: e.m });
		} catch {
			/* a half-written last line after a crash */
		}
	}
	return out.sort((a, b) => a.t - b.t);
}

/** Message types whose latest copy is the state, and where it lands in init. */
const STATE = {
	tasks: (s, m) => (s.tasks = m.tasks),
	approvals: (s, m) => (s.approvals = m.approvals),
	attention: (s, m) => (s.attention = m.items),
	ledger: (s, m) => (s.ledger = m.ledger),
	agents: (s, m) => (s.agents = m.agents),
	'weather-alerts': (s, m) => (s.weatherAlerts = { alerts: m.alerts, checkedAt: m.checkedAt ?? null, stale: Boolean(m.stale) }),
	navigate: (s, m) => (s.view = m.view),
	display: (s, m) => (s.display = { ...(s.display ?? {}), ...m }),
	nowPlaying: (s, m) => (s.nowPlaying = m),
	senses: (s, m) => (s.senses = m.senses ?? s.senses)
};

/**
 * The wall's state at time `at`: the last keyframe before it, with every
 * later state message applied. What a client is sent as `init` when a
 * replay starts mid-day.
 */
export function stateAt(entries, at = Infinity) {
	let state = { type: 'init', view: 'clock' };
	for (const { t, m } of entries) {
		if (t > at) break;
		if (m.type === 'init') state = { ...m, type: 'init' };
		else STATE[m.type]?.(state, m);
	}
	return { ...state, ts: Number.isFinite(at) ? at : Date.now() };
}

/**
 * What to send and when, for a replay from `from` to `to` at `speed`×.
 * Returns [{ delay (ms after start), msg }]; keyframes are left out (the
 * replay sends its own init), and so is anything before `from`.
 */
export function replayPlan(entries, { from = -Infinity, to = Infinity, speed = 1 } = {}) {
	const s = speed > 0 ? speed : 1;
	const inRange = entries.filter((e) => e.t >= from && e.t <= to && e.m.type !== 'init');
	if (!inRange.length) return [];
	const start = Number.isFinite(from) ? from : inRange[0].t;
	return inRange.map((e) => ({ delay: Math.max(0, Math.round((e.t - start) / s)), msg: e.m }));
}
