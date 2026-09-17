import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ACTIONS = ['play-pause', 'next', 'previous', 'stop', 'seek'];

export async function POST({ params, request }) {
	const action = params.action;
	if (!ACTIONS.includes(action)) {
		return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400 });
	}
	try {
		if (action === 'seek') {
			const body = await request.json().catch(() => ({}));
			const position = Number(body?.position);
			if (!Number.isFinite(position) || position < 0) {
				return new Response(JSON.stringify({ error: 'bad position' }), { status: 400 });
			}
			const { stdout, stderr } = await execFileAsync('playerctl', ['position', String(position)], {
				encoding: 'utf8',
				timeout: 2000
			});
			return new Response(
				JSON.stringify({ ok: true, action, out: `${stdout || ''}${stderr || ''}`.trim() })
			);
		}
		const { stdout, stderr } = await execFileAsync('playerctl', [action], {
			encoding: 'utf8',
			timeout: 2000
		});
		return new Response(JSON.stringify({ ok: true, action, out: `${stdout || ''}${stderr || ''}`.trim() }));
	} catch (e) {
		return new Response(
			JSON.stringify({ ok: false, action, error: e.stderr?.toString() || e.message || 'playerctl failed' }),
			{ status: 500 }
		);
	}
}
