/**
 * The wall's answers to open questions ("how far is the moon", "who won the
 * game last night"), the part of a Google or Alexa speaker that commands and
 * chores don't cover.
 *
 *  - isQuestion(text): is this sentence a question for the assistant, not a
 *    chore to add? Reminders and to-dos never are.
 *  - systemPrompt(ctx): the one short instruction the model gets. Kept tiny
 *    on purpose: every request pays for it.
 *  - spokenAnswer(text): what the model wrote, made fit to say out loud.
 *
 * Pure: src/lib/server/assistantHub.js asks Ollama Cloud; tests/assistant.test.mjs.
 */

import { normalizeCommand } from './wallActions.js';

// "remind me", "add", "I need to": always the list, even when phrased oddly.
// "Do the dishes" and "have the car washed" are chores, so "do" and "have"
// only count as a question with someone after them ("do you know", "have we").
const ADD_START = /^(?:remind me|alert|add|put|chore|to-?do|todo|i need to|i have to|i gotta|i've got to|don't let me forget)\b/i;
const QUESTION_START =
	/^(?:who|whom|whose|what|what's|whats|when|when's|where|where's|why|which|how|how's|is|are|was|were|am|does|did|can|could|should|would|will|shall|(?:do|have|has) (?:you|i|we|they|he|she|it)|tell me|explain|search(?: for)?|look up|google|define|translate|calculate|convert|i wonder|i'm wondering|any idea)\b/i;

/** True for a sentence the assistant should answer rather than the list. */
export function isQuestion(text) {
	const raw = String(text || '').trim();
	if (!raw) return false;
	const s = normalizeCommand(raw);
	if (!s || ADD_START.test(s)) return false;
	if (QUESTION_START.test(s)) return true;
	return /\?\s*$/.test(raw);
}

/** The model's whole briefing. A few dozen tokens. */
export function systemPrompt({ now = Date.now(), timeZone = 'America/New_York', place = '' } = {}) {
	const today = new Date(now).toLocaleString('en-US', {
		timeZone,
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
	return [
		'You are a wall display that answers out loud.',
		'Reply in one or two short spoken sentences. No lists, markdown, links or emoji.',
		'Use web_search only for recent or uncertain facts.',
		`Now: ${today}${place ? `, ${place}` : ''}.`
	].join(' ');
}

const MAX_SPOKEN = 320;

/** Markdown, links and citation marks out; at most a couple of sentences. */
export function spokenAnswer(text) {
	let s = String(text || '')
		.replace(/<think>[\s\S]*?<\/think>/gi, ' ')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/【[^】]*】|\[\d+\]/g, '')
		.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
		.replace(/[*_#`>|]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (s.length <= MAX_SPOKEN) return s;
	const sentences = s.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [s];
	let out = '';
	for (const sentence of sentences) {
		if ((out + sentence).trim().length > MAX_SPOKEN) break;
		out += sentence;
	}
	out = out.trim();
	if (out) return out;
	return `${s.slice(0, MAX_SPOKEN).replace(/\s+\S*$/, '')}…`;
}
