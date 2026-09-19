import {
	applyNotifyToRoster,
	applyOllamaHint,
	emptyRoster,
	shouldOpenAgentsView
} from '../agentRoster.js';
import { applyCloudHint, isCloudSource } from '../cloudAgents.js';
import { parseNotifyPayload } from './notifyPayload.js';

let roster = emptyRoster();

export function getAgentRoster() {
	return roster;
}

export function ingestAgentNotify(notify, now = Date.now()) {
	roster = applyNotifyToRoster(roster, notify, now);
	return { roster, openAgents: shouldOpenAgentsView(notify) };
}

export function ingestOllamaStatus(status, now = Date.now()) {
	const next = applyOllamaHint(roster, status, now);
	const changed = next !== roster && JSON.stringify(next) !== JSON.stringify(roster);
	roster = next;
	return { roster, changed };
}

export function ingestCloudSnapshot(snapshot, now = Date.now()) {
	const prev = roster;
	const next = applyCloudHint(roster, snapshot, now);
	const changed = JSON.stringify(next) !== JSON.stringify(prev);
	roster = next;
	const events = [];
	for (const id of ['cursor', 'claude']) {
		const before = prev.find((a) => a.id === id);
		const after = next.find((a) => a.id === id);
		if (!before || !after) continue;
		if (before.phase !== 'working' && after.phase === 'working' && isCloudSource(after.source)) {
			const parsed = parseNotifyPayload({
				event: 'working',
				source: after.source,
				body: after.task
			});
			if (parsed.notify) events.push(parsed.notify);
		} else if (before.phase === 'working' && isCloudSource(before.source) && after.phase === 'done') {
			const parsed = parseNotifyPayload({
				event: 'done',
				source: before.source,
				body: after.task
			});
			if (parsed.notify) events.push(parsed.notify);
		}
	}
	return { roster, changed, events };
}

export function resetAgentRoster() {
	roster = emptyRoster();
	return roster;
}
