import { json } from '@sveltejs/kit';
import { getOllamaPs } from '$lib/server/hostData.js';

export const prerender = false;

export async function GET() {
	return json(await getOllamaPs());
}
