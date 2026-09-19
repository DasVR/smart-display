import { emptyRoster } from './agentRoster.js';

/** Cursor Cloud Agents and Claude Code cloud sessions, mapped onto the
 *  existing Agents roster. A card stays idle until a real payload says
 *  a run is actually in flight. */

export const CURSOR_CLOUD_SOURCE = 'Cursor Cloud';
export const CLAUDE_CLOUD_SOURCE = 'Claude Code Cloud';

const WORKING = new Set([
	'running',
	'active',
	'creating',
	'starting',
	'not_yet_started',
	'waiting_for_background_work',
	'rescheduling'
]);

export function isCloudWorkingStatus(status) {
	return WORKING.has(String(status || '').trim().toLowerCase());
}

export function isCloudSource(source = '') {
	return /\bcloud\b/i.test(String(source || ''));
}

function parseStamp(raw) {
	if (raw == null || raw === '') return 0;
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return raw < 1e12 ? raw * 1000 : raw;
	}
	const n = Date.parse(String(raw));
	return Number.isFinite(n) ? n : 0;
}

export function normalizeCloudItem(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const id = String(raw.id || raw.bcId || '').trim();
	const name = String(raw.name || raw.title || '').trim() || id || 'Cloud agent';
	const status = String(raw.status || '').trim();
	const updatedAt =
		parseStamp(raw.updatedAt) ||
		parseStamp(raw.updatedAtMs) ||
		parseStamp(raw.updated_at) ||
		parseStamp(raw.createdAt) ||
		parseStamp(raw.createdAtMs) ||
		parseStamp(raw.created_at) ||
		0;
	return {
		id,
		name,
		status,
		summary: String(raw.summary || raw.body || '').trim(),
		updatedAt
	};
}

export function normalizeCloudItems(payload) {
	if (!payload) return [];
	if (Array.isArray(payload)) return payload.map(normalizeCloudItem).filter(Boolean);
	const lists = [payload.items, payload.agents, payload.sessions, payload.data];
	for (const list of lists) {
		if (Array.isArray(list)) return list.map(normalizeCloudItem).filter(Boolean);
	}
	return [];
}

export function summarizeCloudLane(items = []) {
	const working = items
		.filter((i) => i && isCloudWorkingStatus(i.status))
		.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
	if (!working.length) {
		return { working: false, task: '', body: '', count: 0, id: '' };
	}
	const lead = working[0];
	const extra = working.length - 1;
	return {
		working: true,
		task: lead.name,
		body: extra > 0 ? `${working.length} cloud runs` : lead.summary || lead.name,
		count: working.length,
		id: lead.id
	};
}

export function snapshotFromPayloads({ cursor, claude } = {}) {
	return {
		cursor: summarizeCloudLane(normalizeCloudItems(cursor)),
		claude: summarizeCloudLane(normalizeCloudItems(claude))
	};
}

function applyLane(agent, lane, cloudSource, now) {
	if (lane?.working) {
		const task = lane.task || 'working';
		if (
			agent.phase === 'working' &&
			agent.task === task &&
			agent.source === cloudSource &&
			agent.body === (lane.body || '')
		) {
			return agent;
		}
		return {
			...agent,
			phase: 'working',
			task,
			body: lane.body || '',
			lastEvent: `${cloudSource} working`,
			source: cloudSource,
			updatedAt: now
		};
	}
	if (agent.phase === 'working' && isCloudSource(agent.source)) {
		return {
			...agent,
			phase: 'done',
			task: 'finished',
			body: agent.body || '',
			lastEvent: `${cloudSource} finished`,
			source: cloudSource,
			updatedAt: now
		};
	}
	return agent;
}

export function applyCloudHint(roster, snapshot = {}, now = Date.now()) {
	const list = Array.isArray(roster) && roster.length ? roster : [];
	return list.map((a) => {
		if (a.id === 'cursor') return applyLane(a, snapshot.cursor, CURSOR_CLOUD_SOURCE, now);
		if (a.id === 'claude') return applyLane(a, snapshot.claude, CLAUDE_CLOUD_SOURCE, now);
		return a;
	});
}

export function cloudDemoRoster(now = Date.now()) {
	return applyCloudHint(
		emptyRoster(),
		{
			cursor: {
				working: true,
				task: 'Smart display efficiency',
				body: 'Cursor Cloud',
				count: 1,
				id: 'bc-demo'
			}
		},
		now
	);
}
