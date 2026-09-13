import { json } from '@sveltejs/kit';
import { getHostUpdates } from '$lib/server/hostUpdates.js';
import { getInstallProgress } from '$lib/server/hostUpgrade.js';

export const prerender = false;

export async function GET() {
	return json({ ...getHostUpdates(), progress: getInstallProgress() });
}
