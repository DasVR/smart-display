/**
 * Agent approvals: when a coding agent stops to ask "may I run this?", the
 * wall (and the phone) can answer instead of the terminal.
 *
 * An agent's hook POSTs a request and waits; the kiosk raises a big Allow /
 * Deny card; whoever taps first decides. If nobody answers before it
 * expires, the request times out and the agent falls back to asking in its
 * own terminal, so the wall can only ever save a trip, never wedge a run.
 *
 * Pure model; the HTTP / WS side is src/lib/server/approvalHub.js and the
 * Claude Code hook is hooks/display-approve.mjs.
 */

export const DECISIONS = ['allow', 'deny'];
const MAX_TITLE = 120;
const MAX_DETAIL = 600;
const MAX_SOURCE = 40;
export const DEFAULT_TIMEOUT_S = 180;
const MIN_TIMEOUT_S = 15;
const MAX_TIMEOUT_S = 900;

function clean(v, max) {
	return String(v ?? '')
		.replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
		.trim()
		.slice(0, max);
}

/** Validate an incoming request: { approval } or { error }. */
export function normalizeApproval(input = {}, { now = Date.now(), id } = {}) {
	const source = clean(input.source, MAX_SOURCE) || 'Agent';
	const tool = clean(input.tool, 40);
	const title = clean(input.title, MAX_TITLE) || (tool ? `Run ${tool}?` : '');
	if (!title) return { error: 'title or tool is required' };
	const secs = Math.round(Number(input.timeout ?? input.timeoutSec ?? DEFAULT_TIMEOUT_S));
	const timeout = Number.isFinite(secs) ? Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, secs)) : DEFAULT_TIMEOUT_S;
	return {
		approval: {
			id,
			source,
			tool,
			title,
			// multi-line on purpose: commands and diffs read better unwrapped
			detail: clean(input.detail, MAX_DETAIL),
			cwd: clean(input.cwd, 120),
			status: 'pending',
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + timeout * 1000).toISOString(),
			decidedAt: null,
			decidedBy: null
		}
	};
}

/** Record a decision. Returns { approval } or { error, status }. */
export function decideApproval(approval, decision, { by = 'display', now = Date.now() } = {}) {
	if (!approval) return { error: 'not found', status: 404 };
	if (!DECISIONS.includes(decision)) return { error: `decision must be ${DECISIONS.join(' or ')}`, status: 400 };
	if (approval.status !== 'pending') return { error: `already ${approval.status}`, status: 409 };
	if (Date.parse(approval.expiresAt) <= now) return { error: 'expired', status: 409 };
	return {
		approval: { ...approval, status: decision, decidedAt: new Date(now).toISOString(), decidedBy: clean(by, 40) || 'display' }
	};
}

/** Time out anything past its deadline. Returns { list, expired }. */
export function expireApprovals(list, now = Date.now()) {
	const expired = [];
	const next = list.map((a) => {
		if (a.status !== 'pending' || Date.parse(a.expiresAt) > now) return a;
		const done = { ...a, status: 'timeout', decidedAt: new Date(now).toISOString() };
		expired.push(done);
		return done;
	});
	return { list: next, expired };
}

/** What the kiosk and phone show: pending requests, oldest first. */
export function pendingApprovals(list, now = Date.now()) {
	return list
		.filter((a) => a.status === 'pending' && Date.parse(a.expiresAt) > now)
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Drop settled requests older than `keepMs`, so memory stays flat. */
export function pruneApprovals(list, now = Date.now(), keepMs = 10 * 60000) {
	return list.filter((a) => a.status === 'pending' || now - Date.parse(a.decidedAt || a.createdAt) < keepMs);
}
