import { json } from '@sveltejs/kit';
import { parseNotifyPayload } from '$lib/server/notifyPayload.js';
import { getAgentRoster, ingestAgentNotify } from '$lib/server/agentRosterState.js';

export const prerender = false;

export async function POST({ request }) {
	let data;
	try {
		data = await request.json();
	} catch {
		return json({ error: 'invalid payload' }, { status: 400 });
	}
	const parsed = parseNotifyPayload(data);
	if (parsed.error) {
		return json({ error: parsed.error }, { status: parsed.status || 400 });
	}
	ingestAgentNotify(parsed.notify);
	return json({ ok: true, agents: getAgentRoster() });
}
