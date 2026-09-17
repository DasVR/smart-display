import { json } from '@sveltejs/kit';
import { getDemoNowPlaying, getNowPlaying } from '$lib/server/hostData.js';

export const prerender = false;

export async function GET({ url }) {
	if (url.searchParams.get('demo') === 'music') {
		return json(getDemoNowPlaying());
	}
	return json(await getNowPlaying());
}
