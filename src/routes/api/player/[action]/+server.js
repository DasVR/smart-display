import { execSync } from 'node:child_process';

const ACTIONS = ['play-pause', 'next', 'previous', 'stop'];

export async function POST({ params }) {
	const action = params.action;
	if (!ACTIONS.includes(action)) {
		return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400 });
	}
	try {
		const out = execSync(`playerctl ${action} 2>&1`, { encoding: 'utf8', timeout: 2000 });
		return new Response(JSON.stringify({ ok: true, action, out: out.trim() }));
	} catch (e) {
		return new Response(
			JSON.stringify({ ok: false, action, error: e.stderr?.toString() || e.message || 'playerctl failed' }),
			{ status: 500 }
		);
	}
}
