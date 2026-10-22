/**
 * The Agents view as lanes: one per session (two Claude Code terminals, a
 * Claude Code web session and a Cursor cloud agent are four lanes), plus
 * Hermes and Ollama from the roster, which report one status each.
 *
 * Everything a lane says fits on the wall without scrolling: who and where,
 * one headline (what the agent says it's doing, else what you asked), one
 * step under it, and how far along when it knows. Order: needs you, then
 * working (longest-running first, so lanes don't jump about), then the
 * last few finished. At most MAX_LANES show; the rest count as "+N more".
 *
 * Pure: src/lib/components/AgentsHub.svelte draws it; tests/agent-board.test.mjs.
 */

import { characterFor } from './agentSprites.js';

export const MAX_LANES = 6;
/** A finished session stays on the board this long. */
export const DONE_FOR_MS = 30 * 60000;
const NAMES = { claude: 'Claude Code', cursor: 'Cursor', hermes: 'Hermes', ollama: 'Ollama' };
const RANK = { waiting: 0, working: 1, error: 2, done: 3 };

/** "Bash: npm test" reads better on a wall as "npm test". */
export function plainStep(task = '') {
	const t = String(task || '').trim();
	const m = /^(Bash|Shell|Edit|Write|Read|Grep|Glob|MCP|WebFetch|WebSearch|Task|Subagent): (.+)$/.exec(t);
	if (!m) return t;
	const verb = { Bash: 'Running', Shell: 'Running', Edit: 'Editing', Write: 'Writing', Read: 'Reading', Grep: 'Searching', Glob: 'Finding', MCP: 'Using', WebFetch: 'Reading', WebSearch: 'Searching', Task: 'Delegating', Subagent: 'Delegating' }[m[1]];
	return `${verb} ${m[2]}`;
}

/** One session as a lane. */
export function sessionLane(s) {
	const agent = s.agent === 'cursor' ? 'cursor' : 'claude';
	const asked = s.prompt ? s.prompt[0].toUpperCase() + s.prompt.slice(1) : '';
	const headline = s.title || asked || (s.phase === 'done' ? 'Finished' : s.phase === 'error' ? 'Stopped' : 'Working');
	let step = s.phase === 'waiting' ? s.task || 'Needs you' : plainStep(s.task);
	if (step === headline || step === 'finished') step = '';
	return {
		key: `${agent}:${s.session}`,
		agent,
		character: characterFor(agent),
		name: NAMES[agent],
		where: [s.project, s.remote ? 'cloud' : ''].filter(Boolean).join(' · '),
		headline,
		step,
		progress: s.progress && s.progress.total ? s.progress : null,
		link: s.link || '',
		phase: s.phase,
		since: s.since || s.at || 0,
		at: s.at || 0
	};
}

/** Hermes or Ollama from the roster (one status each), when they've said anything. */
function rosterLane(a) {
	if (!a || !a.updatedAt || a.phase === 'idle') return null;
	const headline = a.task && !['standby', 'working', 'finished', 'inferring'].includes(a.task) ? a.task : a.id === 'ollama' ? 'Running a local model' : a.phase === 'done' ? 'Finished' : 'Working';
	return {
		key: a.id,
		agent: a.id,
		character: characterFor(a.id),
		name: NAMES[a.id] || a.name,
		where: '',
		headline,
		step: a.body && a.body !== headline ? a.body : '',
		progress: null,
		link: '',
		phase: a.phase,
		since: a.updatedAt,
		at: a.updatedAt
	};
}

/**
 * The board: { lanes, more, counts: { working, waiting } }.
 * `sessions` from /api/agents/sessions (or the 'agent-sessions' message),
 * `roster` the agent roster (for Hermes and Ollama).
 */
export function agentBoard({ sessions = [], roster = [], now = Date.now(), max = MAX_LANES } = {}) {
	const lanes = [
		...(Array.isArray(sessions) ? sessions : []).map(sessionLane),
		...(Array.isArray(roster) ? roster : []).filter((a) => a.id === 'hermes' || a.id === 'ollama').map(rosterLane)
	].filter((l) => l && (l.phase in RANK) && (l.phase === 'working' || l.phase === 'waiting' || now - l.at < DONE_FOR_MS));
	lanes.sort((a, b) => RANK[a.phase] - RANK[b.phase] || (RANK[a.phase] <= 1 ? a.since - b.since : b.at - a.at) || a.key.localeCompare(b.key));
	const counts = {
		working: lanes.filter((l) => l.phase === 'working').length,
		waiting: lanes.filter((l) => l.phase === 'waiting').length
	};
	return { lanes: lanes.slice(0, max), more: Math.max(0, lanes.length - max), counts };
}

/** "12m", "1h 5m": how long a lane has been at it. */
export function elapsed(since, now = Date.now()) {
	const min = Math.max(0, Math.floor((now - (since || now)) / 60000));
	if (min < 1) return 'now';
	if (min < 60) return `${min}m`;
	return `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`;
}

/** The line in the view's corner: "2 working · 1 needs you", or the calm version. */
export function boardSummary({ working = 0, waiting = 0 } = {}) {
	const parts = [];
	if (waiting) parts.push(`${waiting} need${waiting === 1 ? 's' : ''} you`);
	if (working) parts.push(`${working} working`);
	return parts.length ? parts.join(' · ') : 'All quiet';
}

/** A believable board for ?demo=agents (and ?demo=agents&lanes=1…8 to see each layout). */
export function demoSessions(now = Date.now(), count = 4) {
	const m = 60000;
	const all = [
		{ agent: 'claude', session: 'a', phase: 'working', title: 'Redesigning the Agents view', task: 'Edit: AgentsHub.svelte', progress: { done: 3, total: 6 }, project: 'smart-display', remote: false, since: now - 24 * m, at: now - 4000 },
		{ agent: 'claude', session: 'b', phase: 'waiting', prompt: 'migrate the lyrics store', task: 'Allow: npm install better-sqlite3', project: 'smart-display', remote: true, since: now - 9 * m, at: now - 30000 },
		{ agent: 'cursor', session: 'cloud-1', phase: 'working', title: 'Fix flaky weather test', task: 'Shell: npm test', project: 'smart-display', remote: true, since: now - 41 * m, at: now - 8000 },
		{ agent: 'cursor', session: 'c', phase: 'done', prompt: 'tidy the README', task: 'tidy the README', project: 'smart-display', remote: false, since: now - 70 * m, at: now - 6 * m },
		{ agent: 'claude', session: 'd', phase: 'working', prompt: 'why is the radar blank at night', task: 'Grep: radarTiles', project: 'smart-display', remote: true, since: now - 3 * m, at: now - 2000 },
		{ agent: 'cursor', session: 'cloud-2', phase: 'working', title: 'Port the remote to the new tab bar', task: 'Edit: RemoteTabBar.svelte', progress: { done: 5, total: 7 }, project: 'smart-display', remote: true, since: now - 52 * m, at: now - 3000 },
		{ agent: 'claude', session: 'e', phase: 'working', title: 'Write the voice-server docs', task: 'Write: voice-server.md', project: 'smart-display', since: now - 12 * m, at: now - 5000 },
		{ agent: 'claude', session: 'f', phase: 'working', prompt: 'bump svelte', task: 'Bash: npm install', project: 'site', since: now - m, at: now - 1000 }
	];
	// the first lane alone is the one working, so a single lane shows the solo stage at work
	return count === 1 ? [all[0]] : all.slice(0, Math.max(1, Math.min(all.length, count)));
}
