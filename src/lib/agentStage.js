/**
 * Who stands on the wall's bottom edge, and doing what.
 *
 *  - an agent with a question (an approval waiting) stands up and asks
 *  - an agent that's working sits at its laptop and types
 *  - anyone else isn't on stage (they're on the Agents view)
 *
 * One character per agent kind (Claude, Cursor, Gemini), always in that order
 * so nobody jumps places when someone else arrives. An approval from an agent
 * the wall doesn't have a character for is asked by Clawd.
 *
 * Pure: src/lib/components/AgentStage.svelte; tests/agent-stage.test.mjs.
 */

import { CHARACTERS, characterFor } from './agentSprites.js';

const ORDER = Object.keys(CHARACTERS);

/**
 * roster: agentRoster ([{ id, name, phase, task }]); approvals: pending
 * approvals, oldest first. Returns [{ character, name, target, task,
 * approval, waiting }] where waiting counts that character's other approvals.
 */
export function castFor({ roster = [], approvals = [] } = {}) {
	const byChar = new Map();
	for (const a of roster || []) {
		if (a?.phase !== 'working') continue;
		const character = characterFor(a.name || a.id);
		if (!character) continue;
		byChar.set(character, { character, name: a.name || CHARACTERS[character].label, target: 'work', task: a.task || '', approval: null, waiting: 0 });
	}
	for (const ap of approvals || []) {
		if (ap?.status && ap.status !== 'pending') continue;
		const character = characterFor(ap.source) ?? 'claude';
		const entry = byChar.get(character) ?? { character, name: ap.source || CHARACTERS[character].label, task: '', waiting: 0 };
		if (entry.approval) entry.waiting += 1;
		else {
			entry.approval = ap;
			entry.name = ap.source || entry.name;
		}
		entry.target = 'ask';
		byChar.set(character, entry);
	}
	return ORDER.filter((c) => byChar.has(c)).map((c) => byChar.get(c));
}

/** The one whose question the bubble shows: the oldest waiting approval. */
export function speakerOf(cast = []) {
	const asking = cast.filter((c) => c.approval);
	if (!asking.length) return null;
	return asking.reduce((a, b) => (Date.parse(a.approval.createdAt || 0) <= Date.parse(b.approval.createdAt || 0) ? a : b));
}

/** "2:05" or "45s" until an approval times out. */
export function countdown(expiresAt, now = Date.now()) {
	const s = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
	if (!Number.isFinite(s)) return '';
	return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
