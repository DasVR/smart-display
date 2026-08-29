import { json } from '@sveltejs/kit';
import { getCalendar } from '$lib/server/hostData.js';

export const prerender = false;

export async function GET({ url }) {
	const days = url.searchParams.get('days') || '3';
	return json(await getCalendar(days));
}
