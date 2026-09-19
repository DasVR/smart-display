import { json } from '@sveltejs/kit';
import { getHostLoad } from '$lib/server/hostLoad.js';

export const prerender = false;

export async function GET() {
	return json(getHostLoad());
}
