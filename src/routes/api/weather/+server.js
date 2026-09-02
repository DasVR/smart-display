import { json } from '@sveltejs/kit';
import { getWeather } from '$lib/server/hostData.js';

export const prerender = false;

export async function GET({ url }) {
	const hours = url.searchParams.get('hours') || '48';
	return json(await getWeather(parseInt(hours, 10)));
}
