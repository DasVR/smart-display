import { json } from '@sveltejs/kit';
import { getHostUpdates } from '$lib/server/hostUpdates.js';
import { getInstallProgress, maybeStartHostUpgrade } from '$lib/server/hostUpgrade.js';

export const prerender = false;

export async function GET() {
	const snapshot = await getHostUpdates();
	maybeStartHostUpgrade(snapshot);
	return json({ ...snapshot, progress: getInstallProgress() });
}
