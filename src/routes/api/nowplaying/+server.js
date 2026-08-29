import { json } from '@sveltejs/kit';
import { getNowPlaying } from '$lib/server/hostData.js';

export const prerender = false;

export async function GET() {
	return json(getNowPlaying());
}
