import { json } from '@sveltejs/kit';
import { getKioskStatus } from '$lib/server/kioskStatus.js';

export const prerender = false;

export async function GET() {
	return json(await getKioskStatus());
}
