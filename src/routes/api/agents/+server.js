import { json } from '@sveltejs/kit';
import { getAgentRoster, ingestCloudSnapshot } from '$lib/server/agentRosterState.js';
import { refreshCloudSnapshot } from '$lib/server/cloudAgentsPoll.js';

export const prerender = false;

export async function GET() {
	try {
		const snapshot = await refreshCloudSnapshot();
		ingestCloudSnapshot(snapshot);
	} catch {
		/* Cursor / Claude cloud polls are optional */
	}
	return json({ agents: getAgentRoster() });
}
