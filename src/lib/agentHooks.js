/**
 * What the coding agents are doing, from their own hooks.
 *
 * Claude Code and Cursor both run hooks at every step of a session (a prompt
 * sent, a tool run, a question for you, the turn over) and hand each hook the
 * step as JSON. hooks/wall-status.mjs forwards that JSON, untouched, to
 * POST /api/agents/hook; this file reads it. Same for Claude Code on the web
 * and Cursor's cloud agents, as long as the hook can reach the wall.
 *
 * Each agent can have several sessions going (a terminal, the web, a cloud
 * agent); the Agents view shows each one, and the roster the busiest:
 * needs you > working > done > idle.
 *
 * Beyond the raw steps, a session can say what it's doing in its own words:
 * Claude Code's to-do list (TodoWrite) gives the current step and "2 of 5",
 * and an agent can report a headline itself (the WallReport step, from
 * hooks/wall-report.mjs, its MCP tool `report_progress` or its CLI).
 * A session that goes quiet for STALE_MS without finishing (closed laptop,
 * reclaimed container) stops counting as working.
 *
 * Pure: src/ws-server.js keeps the sessions; tests/agent-hooks.test.mjs.
 */

export const STALE_MS = 15 * 60000;
// a finished session is still shown as "finished" this long, then forgotten
export const FORGET_MS = 6 * 3600000;

const clip = (v, n) =>
	String(v ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, n);

/** The last folder of a path: "smart-display" from "/home/me/smart-display". */
export function projectOf(cwd) {
	const parts = String(cwd || '')
		.split(/[\\/]+/)
		.filter(Boolean);
	return clip(parts.at(-1) || '', 40);
}

/** "Bash: npm test", "Edit: senses.js", "Grep", from a tool and its input. */
export function toolLine(name, input) {
	const tool = clip(name, 30);
	if (!tool) return '';
	const i = input && typeof input === 'object' ? input : {};
	const file = i.file_path || i.path || i.notebook_path;
	const what = i.command ?? (file ? projectOf(file) : '') ?? '';
	const detail = clip(what || i.pattern || i.description || i.url || '', 60);
	return detail ? `${tool}: ${detail}` : tool;
}

/** A to-do list (TodoWrite's `todos`) as { step, done, total }, or null. */
export function todoProgress(todos) {
	if (!Array.isArray(todos) || !todos.length) return null;
	const items = todos.filter((t) => t && typeof t === 'object').slice(0, 50);
	if (!items.length) return null;
	const done = items.filter((t) => t.status === 'completed').length;
	const now = items.find((t) => t.status === 'in_progress');
	const step = clip(now?.activeForm || now?.content || '', 80);
	return { step, done, total: items.length };
}

const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(999, Math.floor(Number(v))) : null);
/** { done, total } from a report, or null when it doesn't make sense. */
function progressOf(done, total) {
	const d = num(done);
	const t = num(total);
	return t && d !== null && d <= t ? { done: d, total: t } : null;
}
/** Only http(s) links, so a report can't put anything else on the wall. */
export function safeLink(v) {
	const s = clip(v, 300);
	return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

/** Which agent sent a hook: the `agent` the hook named, or a guess from the JSON's shape. */
export function agentOfHook(body = {}, named = '') {
	const n = String(named || '').toLowerCase();
	if (n === 'claude' || n === 'cursor') return n;
	if (body.agent === 'claude' || body.agent === 'cursor') return body.agent;
	// Cursor's hooks carry conversation_id and camelCase event names; Claude Code's session_id and PascalCase
	if (body.conversation_id || /^[a-z]/.test(String(body.hook_event_name || ''))) return 'cursor';
	return 'claude';
}

/**
 * One hook's JSON as { agent, session, phase, task, prompt, project, remote,
 * title?, progress?, link? } or null
 * when the step says nothing about the session's state. phase:
 * 'working' | 'waiting' (needs you) | 'done' | 'error' | 'ended'.
 */
export function readHook(body = {}, { agent: named = '', remote = false } = {}) {
	if (!body || typeof body !== 'object') return null;
	const agent = agentOfHook(body, named);
	const event = String(body.hook_event_name || '');
	const session = clip(body.session_id || body.conversation_id || body.ccr_session_id || '', 80) || 'default';
	const project = projectOf(body.cwd || (Array.isArray(body.workspace_roots) ? body.workspace_roots[0] : ''));
	const prompt = clip(String(body.prompt ?? '').split('\n')[0], 80);
	let phase = null;
	let task = '';
	let title;
	let progress;
	let link;
	switch (event) {
		// the agent's own words (hooks/wall-report.mjs): a headline, the step, how far along
		case 'WallReport': {
			const p = String(body.phase || 'working');
			phase = ['working', 'waiting', 'done', 'error'].includes(p) ? p : 'working';
			title = clip(body.summary, 80);
			task = clip(body.step, 80);
			const pr = progressOf(body.done, body.total);
			if (pr) progress = pr;
			link = safeLink(body.link);
			if (!title && !task && !pr && phase === 'working') return null;
			break;
		}
		// Claude Code
		case 'UserPromptSubmit':
		case 'beforeSubmitPrompt':
			phase = 'working';
			task = 'Thinking';
			break;
		case 'PreToolUse':
		case 'PostToolUse':
		case 'PostToolUseFailure':
		case 'preToolUse':
		case 'postToolUse': {
			phase = 'working';
			// the to-do list is the plan: its current item is the step, and how many are done
			const todo = body.tool_name === 'TodoWrite' ? todoProgress(body.tool_input?.todos) : null;
			if (todo) {
				task = todo.step || 'Planning';
				progress = { done: todo.done, total: todo.total };
			} else task = toolLine(body.tool_name, body.tool_input);
			break;
		}
		case 'SubagentStart':
			phase = 'working';
			task = clip(`Subagent${body.agent_type ? `: ${body.agent_type}` : ''}`, 60);
			break;
		case 'beforeShellExecution':
		case 'afterShellExecution':
			phase = 'working';
			task = clip(`Shell: ${body.command || ''}`, 70);
			break;
		case 'beforeMCPExecution':
		case 'afterMCPExecution':
			phase = 'working';
			task = clip(`MCP: ${body.tool_name || ''}`, 60);
			break;
		case 'afterFileEdit':
		case 'beforeReadFile':
			phase = 'working';
			task = clip(`${event === 'afterFileEdit' ? 'Edit' : 'Read'}: ${projectOf(body.file_path)}`, 60);
			break;
		case 'afterAgentThought':
		case 'afterAgentResponse':
			phase = 'working';
			break;
		case 'PermissionRequest':
			phase = 'waiting';
			task = toolLine(body.tool_name, body.tool_input) || 'Needs permission';
			break;
		case 'Notification': {
			const kind = String(body.notification_type || '');
			if (kind === 'idle_prompt') phase = 'done';
			else if (kind === 'permission_prompt' || kind.startsWith('elicitation') || kind === 'agent_needs_input') {
				phase = 'waiting';
				task = clip(body.message || 'Needs you', 80);
			}
			break;
		}
		case 'Stop':
			phase = 'done';
			break;
		case 'StopFailure':
			phase = 'error';
			task = clip(body.error || body.reason || 'Stopped with an error', 80);
			break;
		case 'stop': {
			const status = String(body.status || 'completed');
			phase = status === 'error' ? 'error' : 'done';
			if (status === 'aborted') task = 'Stopped';
			break;
		}
		case 'SessionEnd':
		case 'sessionEnd':
			phase = 'ended';
			break;
		default:
			return null;
	}
	if (!phase) return null;
	const asked = event === 'UserPromptSubmit' || event === 'beforeSubmitPrompt' ? prompt : '';
	const out = { agent, session, phase, task, prompt: asked, project, remote: Boolean(remote) };
	if (title) out.title = title;
	if (progress) out.progress = progress;
	if (link) out.link = link;
	return out;
}

/**
 * The sessions with one hook's step applied. `sessions` is
 * { [agent:session]: { agent, session, phase, task, project, remote, prompt,
 *   title, progress, link, since, at } }.
 * `prompt` keeps what you asked while the tools run underneath it; `title`
 * (the agent's own headline), `progress` and `link` last until a new prompt
 * starts a fresh turn (a headline and link last the whole session).
 */
export function applyHook(sessions = {}, step, now = Date.now()) {
	if (!step) return sessions;
	const key = `${step.agent}:${step.session}`;
	const was = sessions[key];
	const next = { ...sessions };
	if (step.phase === 'ended') {
		delete next[key];
		return next;
	}
	const fresh = !was || (was.phase !== 'working' && was.phase !== 'waiting');
	// what you asked stays with the session while its tools run, and names the finish
	const prompt = step.prompt || (fresh && step.phase === 'working' ? '' : was?.prompt || '');
	let task = step.task;
	// a report with only a headline keeps the step it was on
	if (!task && step.title && was?.task) task = was.task;
	if (!task) task = step.phase === 'working' ? was?.task || 'Working' : step.phase === 'done' ? prompt : '';
	const newTurn = Boolean(step.prompt);
	next[key] = {
		agent: step.agent,
		session: step.session,
		phase: step.phase,
		task,
		prompt,
		project: step.project || was?.project || '',
		remote: step.remote || Boolean(was?.remote),
		title: step.title || was?.title || '',
		progress: step.progress || (newTurn ? null : was?.progress || null),
		link: step.link || was?.link || '',
		since: fresh && (step.phase === 'working' || step.phase === 'waiting') ? now : (was?.since ?? now),
		at: now
	};
	return next;
}

/** Sessions with the long-quiet ones let go: working ones that never finished, finished ones long ago. */
export function sweepSessions(sessions = {}, now = Date.now()) {
	let changed = false;
	const next = {};
	for (const [key, s] of Object.entries(sessions)) {
		const quiet = now - (s.at || 0);
		if ((s.phase === 'working' || s.phase === 'waiting') && quiet >= STALE_MS) {
			next[key] = { ...s, phase: 'done', task: s.prompt || s.task, stale: true };
			changed = true;
		} else if (quiet >= FORGET_MS) changed = true;
		else next[key] = s;
	}
	return changed ? next : sessions;
}

const RANK = { waiting: 4, working: 3, error: 2, done: 1 };

/**
 * What one agent is doing across its sessions, for the roster:
 * { phase: 'working' | 'waiting' | 'done' | 'error' | 'idle', task, body, sessions, remote, at }.
 */
export function agentStatus(sessions = {}, agent) {
	const mine = Object.values(sessions).filter((s) => s.agent === agent);
	if (!mine.length) return { phase: 'idle', task: '', body: '', sessions: 0, busy: 0, remote: false, stale: false, at: 0 };
	const top = mine.reduce((a, b) => ((RANK[b.phase] || 0) > (RANK[a.phase] || 0) || ((RANK[b.phase] || 0) === (RANK[a.phase] || 0) && b.at > a.at) ? b : a));
	const busy = mine.filter((s) => s.phase === 'working' || s.phase === 'waiting').length;
	const where = [top.project, top.remote ? 'cloud' : ''].filter(Boolean).join(' · ');
	const task = top.phase === 'waiting' ? top.task || 'Needs you' : top.phase === 'working' ? top.task || 'Working' : top.task || (top.phase === 'error' ? 'Stopped with an error' : 'finished');
	const others = busy - (top.phase === 'working' || top.phase === 'waiting' ? 1 : 0);
	const body = [where, top.prompt && top.prompt !== task ? `“${top.prompt}”` : '', others > 0 ? `+${others} more` : ''].filter(Boolean).join(' · ');
	return { phase: top.phase, task, body, sessions: mine.length, busy, remote: mine.some((s) => s.remote), stale: Boolean(top.stale), at: top.at };
}

/**
 * Cursor's cloud agents (GET https://api.cursor.com/v1/agents, `items`) as
 * sessions: ACTIVE is working, IDLE finished. Archived ones, and any not
 * touched in FORGET_MS, are left out. Replaces every earlier cloud session.
 */
export function withCursorCloud(sessions = {}, items = [], now = Date.now()) {
	const next = {};
	for (const [key, s] of Object.entries(sessions)) if (!key.startsWith('cursor:cloud-')) next[key] = s;
	for (const a of Array.isArray(items) ? items : []) {
		const status = String(a?.status || '').toUpperCase();
		if (!a?.id || (status !== 'ACTIVE' && status !== 'IDLE')) continue;
		const at = Date.parse(a.updatedAt || a.createdAt || '') || now;
		if (now - at >= FORGET_MS) continue;
		const key = `cursor:cloud-${clip(a.id, 60)}`;
		const was = sessions[key];
		const phase = status === 'ACTIVE' ? 'working' : 'done';
		const repo = a.source?.repository || a.repository || '';
		next[key] = {
			agent: 'cursor',
			session: `cloud-${clip(a.id, 60)}`,
			phase,
			task: clip(a.summary, 80) || clip(a.name, 80) || (phase === 'working' ? 'Working' : 'finished'),
			prompt: '',
			project: projectOf(String(repo).replace(/\.git$/, '')),
			remote: true,
			title: clip(a.name, 80) || was?.title || '',
			progress: was?.progress || null,
			link: safeLink(a.target?.prUrl || a.prUrl || a.target?.url || '') || was?.link || '',
			since: phase === 'working' && was?.phase !== 'working' ? now : (was?.since ?? at),
			// a cloud agent's own clock, so an idle one keeps its finish time
			at: phase === 'working' ? Math.max(at, was?.at || 0) : at
		};
	}
	return next;
}
