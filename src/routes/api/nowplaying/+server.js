import { json } from '@sveltejs/kit';
import { getDemoNowPlaying, getVoiceDemoNowPlaying, getNowPlaying } from '$lib/server/hostData.js';

export const prerender = false;

export async function GET({ url }) {
	if (url.searchParams.get('demo') === 'music') {
		return json(getDemoNowPlaying());
	}
	if (url.searchParams.get('demo') === 'voices') {
		const t = Number(url.searchParams.get('t'));
		return json(
			getVoiceDemoNowPlaying(Number.isFinite(t) ? t : undefined, url.searchParams.get('freeze') === '1')
		);
	}
	return json(await getNowPlaying());
}
