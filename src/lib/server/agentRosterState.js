import {
	applyNotifyToRoster,
	applyOllamaHint,
	emptyRoster,
	shouldOpenAgentsView
} from '../agentRoster.js';

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

export function resetAgentRoster() {
	roster = emptyRoster();
	return roster;
}
