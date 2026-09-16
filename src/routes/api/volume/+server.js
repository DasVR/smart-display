import { json } from '@sveltejs/kit';
import { applyVolumePayload, getVolume, volumeHttpStatus } from '$lib/server/audioVolume.js';

export const prerender = false;

export async function GET() {
	const result = await getVolume();
	return json(result, { status: volumeHttpStatus(result) });
}

export async function POST({ request }) {
	let data;
	try {
		data = await request.json();
	} catch {
		return json({ ok: false, error: 'invalid payload' }, { status: 400 });
	}
	const result = await applyVolumePayload(data);
	return json(result, { status: volumeHttpStatus(result) });
}
