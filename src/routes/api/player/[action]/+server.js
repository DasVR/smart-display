import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ACTIONS = ['play-pause', 'next', 'previous', 'stop'];

export async function POST({ params }) {
	const action = params.action;
	if (!ACTIONS.includes(action)) {
		return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400 });
	}
	try {
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
