import { json } from '@sveltejs/kit';
import { getTelemetry } from '$lib/server/hostData.js';

export const prerender = false;

export async function GET() {
	return json(await getTelemetry());
}
