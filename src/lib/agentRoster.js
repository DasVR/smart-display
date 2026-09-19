/** Live Claude Code / Cursor / Hermes / Ollama roster. Status comes from
 *  `/api/notify` (`working` / `done`), Cursor Cloud / Claude cloud polls,
 *  and the local Ollama inferring hint. No invented traces: a card stays
 *  idle until a real signal lands. */

export const AGENT_DEFS = [
	{ id: 'claude', name: 'Claude Code' },
	{ id: 'cursor', name: 'Cursor' },
	{ id: 'hermes', name: 'Hermes' },
	{ id: 'ollama', name: 'Ollama' }
];

export function emptyRoster() {
	return AGENT_DEFS.map((d) => ({
		id: d.id,
		name: d.name,
		phase: 'idle',
		task: 'standby',
		source: d.name,
		body: '',
		lastEvent: '',
		updatedAt: 0
	}));
}

export function identifyAgent(source = '', title = '') {
	const hay = `${source} ${title}`.toLowerCase();
	if (hay.includes('cursor')) return 'cursor';
	if (hay.includes('claude')) return 'claude';
	if (hay.includes('hermes')) return 'hermes';
	if (hay.includes('ollama')) return 'ollama';
	if (hay.includes('cloud agent') || hay.includes('cloud code')) return 'cursor';
	return null;
}

export function isAgentStatusEvent(notify = {}) {
	const k = String(notify.kind || '').toLowerCase();
	if (k === 'working' || k === 'start' || k === 'done') return true;
	return /\bfinished$/i.test(String(notify.title || ''));
}

export function shouldOpenAgentsView(notify = {}) {
	const id = identifyAgent(notify.source, notify.title);
	if (!id || id === 'ollama') return false;
	const k = String(notify.kind || '').toLowerCase();
	return k === 'done' || k === 'working' || k === 'start' || /\bfinished$/i.test(String(notify.title || ''));
}

function phaseFromNotify(notify) {
	const k = String(notify.kind || '').toLowerCase();
	if (k === 'working' || k === 'start') return 'working';
	if (k === 'done' || /\bfinished$/i.test(String(notify.title || ''))) return 'done';
	return null;
}

export function applyNotifyToRoster(roster, notify = {}, now = Date.now()) {
	const id = identifyAgent(notify.source, notify.title);
	const phase = phaseFromNotify(notify);
	if (!id || !phase) return roster;
	const list = Array.isArray(roster) && roster.length ? roster : emptyRoster();
	return list.map((a) => {
		if (a.id !== id) return a;
		const task =
			phase === 'working'
				? notify.body || notify.title || 'working'
				: notify.body || 'finished';
		return {
			...a,
			phase,
			task,
			body: notify.body || '',
			lastEvent: notify.title || '',
			source: notify.source || a.name,
			updatedAt: now
		};
	});
}

export function applyOllamaHint(roster, status, now = Date.now()) {
	const list = Array.isArray(roster) && roster.length ? roster : emptyRoster();
	const inferring = status === 'inferring';
	return list.map((a) => {
		if (a.id !== 'ollama') return a;
		if (inferring) {
			if (a.phase === 'working' && a.task === 'inferring') return a;
			return {
				...a,
				phase: 'working',
				task: 'inferring',
				body: 'Local model occupying VRAM',
				lastEvent: 'Ollama working',
				source: 'Ollama',
				updatedAt: now
			};
		}
		if (a.phase === 'working') {
			return {
				...a,
				phase: 'done',
				task: 'finished',
				body: 'Local model is idle',
				lastEvent: 'Agent finished',
				source: 'Ollama',
				updatedAt: now
			};
		}
		return a;
	});
}

export function workingAgents(roster) {
	return (roster || []).filter((a) => a.phase === 'working');
}

/** The agent the stage should put on the poster: whoever is working,
 *  otherwise the most recent finish, otherwise nothing (idle field). */
export function leadAgent(roster) {
	const list = Array.isArray(roster) ? roster : [];
	const working = workingAgents(list).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
	if (working[0]) return working[0];
	const done = list
		.filter((a) => a.phase === 'done' && a.updatedAt)
		.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
	return done[0] || null;
}

export function workingIslandActivity(roster) {
	const working = workingAgents(roster);
	if (!working.length) return null;
	if (working.length === 1) {
		return {
			id: 'agents',
			kind: 'status',
			title: working[0].name,
			body: working[0].task || 'Working',
			severity: 'info'
		};
	}
	return {
		id: 'agents',
		kind: 'status',
		title: `${working.length} agents`,
		body: working.map((a) => a.name).join(', '),
		severity: 'info'
	};
}

export function relativeAge(updatedAt, now = Date.now()) {
	if (!updatedAt) return 'no signal';
	const sec = Math.max(0, Math.round((now - updatedAt) / 1000));
	if (sec < 3) return 'just now';
	if (sec < 60) return `${sec}s ago`;
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 48) return `${hr}h ago`;
	return `${Math.round(hr / 24)}d ago`;
}

export function demoRoster(now = Date.now()) {
	const started = applyNotifyToRoster(
		emptyRoster(),
		{
			kind: 'working',
			source: 'Claude Code',
			title: 'Claude Code working',
			body: 'Editing the Agents tab'
		},
		now - 4000
	);
	return applyNotifyToRoster(
		started,
		{
			kind: 'done',
			source: 'Cursor',
			title: 'Cursor finished',
			body: 'PR checks green'
		},
		now - 12000
	);
}
