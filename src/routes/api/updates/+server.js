import { json } from '@sveltejs/kit';
import { getHostUpdates } from '$lib/server/hostUpdates.js';

export const prerender = false;

export async function GET() {
	return json(getHostUpdates());
}
