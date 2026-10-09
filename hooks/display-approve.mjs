#!/usr/bin/env node
/**
 * Claude Code hook: ask the wall (and the phone remote) before a tool runs.
 *
 * Wire it to PermissionRequest, which fires exactly when Claude Code would
 * otherwise stop and ask you in the terminal. The display raises an Allow /
 * Deny card; the first tap answers. If nobody answers in time, or the display
 * can't be reached, this prints nothing and Claude Code asks in the terminal
 * as usual, so it never blocks a run.
 *
 *   "hooks": {
 *     "PermissionRequest": [{
 *       "hooks": [{
 *         "type": "command",
 *         "command": "DISPLAY_HOST=http://<display-host>:3000 node /path/to/smart-display/hooks/display-approve.mjs",
 *         "timeout": 120
 *       }]
 *     }]
 *   }
 *
 * Env: DISPLAY_HOST (default http://localhost:3000), DISPLAY_API_TOKEN (if
 * the display has one), DISPLAY_SOURCE (default "Claude Code"),
 * DISPLAY_APPROVAL_TIMEOUT seconds (default 110: keep it under the hook's
 * own "timeout"). Also works on PreToolUse, answering with
 * permissionDecision instead. Node 18+.
 */
const HOST = (process.env.DISPLAY_HOST || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.DISPLAY_API_TOKEN || '';
const SOURCE = process.env.DISPLAY_SOURCE || 'Claude Code';
const TIMEOUT = Math.max(15, Number(process.env.DISPLAY_APPROVAL_TIMEOUT) || 110);

async function readStdin() {
	let raw = '';
	for await (const chunk of process.stdin) raw += chunk;
	try {
		return JSON.parse(raw || '{}');
	} catch {
		return {};
	}
}

/** One readable line for the card: the command, the file, or the input. */
export function describe(tool, input = {}) {
	if (input.command) return String(input.command);
	if (input.file_path) return String(input.file_path);
	if (input.url) return String(input.url);
	if (input.pattern) return String(input.pattern);
	const json = JSON.stringify(input);
	return json === '{}' ? '' : json;
}

export function verb(tool) {
	if (tool === 'Bash') return 'Run a command';
	if (tool === 'Edit' || tool === 'MultiEdit') return 'Edit a file';
	if (tool === 'Write') return 'Write a file';
	if (tool === 'WebFetch') return 'Fetch a page';
	if (tool?.startsWith('mcp__')) return `Use ${tool.split('__').slice(1).join(' ')}`;
	return tool ? `Use ${tool}` : 'Continue';
}

/** What Claude Code reads back on stdout. */
export function hookOutput(event, decision) {
	const message = decision === 'deny' ? 'Denied from the smart display' : 'Allowed from the smart display';
	if (event === 'PreToolUse') {
		return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: message } };
	}
	return {
		hookSpecificOutput: {
			hookEventName: 'PermissionRequest',
			decision: decision === 'deny' ? { behavior: 'deny', message } : { behavior: 'allow' }
		}
	};
}

async function main() {
	const input = await readStdin();
	const tool = input.tool_name || '';
	const headers = { 'Content-Type': 'application/json' };
	if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
	try {
		const res = await fetch(`${HOST}/api/approvals?wait=1`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				source: SOURCE,
				tool,
				title: `${verb(tool)}?`,
				detail: describe(tool, input.tool_input),
				cwd: input.cwd ? String(input.cwd).split('/').slice(-2).join('/') : '',
				timeout: TIMEOUT
			}),
			signal: AbortSignal.timeout((TIMEOUT + 5) * 1000)
		});
		if (!res.ok) return;
		const { decision } = await res.json();
		if (decision === 'allow' || decision === 'deny') {
			process.stdout.write(JSON.stringify(hookOutput(input.hook_event_name, decision)));
		}
	} catch {
		// display unreachable or timed out: say nothing, the terminal asks
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main();
