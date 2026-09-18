import { json } from '@sveltejs/kit';
import { applyLyricAction, getLyricMonitor } from '$lib/server/lyricMonitor.js';

export const prerender = false;

export async function GET() {
	return json(await getLyricMonitor());
}

export async function POST({ request }) {
	let body = {};
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'invalid payload' }, { status: 400 });
	}
	const result = await applyLyricAction(body);
	if (result?.ok === false) return json(result, { status: 400 });
	return json({ ok: true, ...result });
}
