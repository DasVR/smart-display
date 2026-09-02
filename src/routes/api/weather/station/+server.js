import { json } from '@sveltejs/kit';
import { saveStationData } from '$lib/server/hostData.js';

export const prerender = false;

export async function POST({ request }) {
	try {
		const data = await request.json();
		saveStationData(data);
		return json({ ok: true, ts: Date.now() });
	} catch (e) {
		return json({ ok: false, error: e.message }, 400);
	}
}
