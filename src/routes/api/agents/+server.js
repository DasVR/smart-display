import { json } from '@sveltejs/kit';
import { getAgentRoster } from '$lib/server/agentRosterState.js';

export const prerender = false;

export async function GET() {
	return json({ agents: getAgentRoster() });
}
