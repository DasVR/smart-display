import { json } from '@sveltejs/kit';
import { applyLyricAction, getLyricMonitor } from '$lib/server/lyricMonitor.js';

export const prerender = false;

export async function GET({ url }) {
	const demo = url.searchParams.has('demo');
	return json(await getLyricMonitor({ demo }));
}

export async function POST({ request, url }) {
	let body = {};
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'invalid payload' }, { status: 400 });
	}
	const demo = Boolean(body.demo) || url.searchParams.has('demo');
	const result = await applyLyricAction({ ...body, demo });
	if (result?.ok === false) return json(result, { status: 400 });
	return json({ ok: true, ...result });
}
