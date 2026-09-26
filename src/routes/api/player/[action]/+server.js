import { runPlayerctl } from '$lib/server/playerctlBin.js';

const ACTIONS = ['play-pause', 'next', 'previous', 'stop', 'seek'];

export async function POST({ params, request }) {
	const action = params.action;
	if (!ACTIONS.includes(action)) {
		return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400 });
	}
	let args = [action];
	if (action === 'seek') {
		const body = await request.json().catch(() => ({}));
		const position = Number(body?.position);
		if (!Number.isFinite(position) || position < 0) {
			return new Response(JSON.stringify({ error: 'bad position' }), { status: 400 });
		}
		args = ['position', String(position)];
	}
	const result = await runPlayerctl(args, { timeout: 2000 });
	if (!result.ok) {
		return new Response(JSON.stringify({ ok: false, action, error: result.errorText }), { status: 500 });
	}
	return new Response(JSON.stringify({ ok: true, action, out: `${result.stdout || ''}${result.stderr || ''}`.trim() }));
}
