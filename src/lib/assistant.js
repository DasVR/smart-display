/**
 * The wall in conversation: what the model is told, the tools it can use,
 * and making its words fit to say out loud.
 *
 *  - systemPrompt(ctx): the whole briefing. Kept short on purpose: every
 *    request pays for it.
 *  - TOOLS: the wall's commands, the list, music, and web search.
 *  - spokenAnswer(text): markdown, links and citations out; a couple of
 *    sentences at most.
 *  - asksBack(say): the wall just asked something, so the next thing said
 *    is the answer (the microphone keeps listening for it).
 *
 * Pure: src/lib/server/assistantHub.js talks to Ollama Cloud; tests/assistant.test.mjs.
 */

/** The model's whole briefing. */
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
		"You are the wall, the voice of a smart display in someone's home.",
		'Talk like a friendly person: casual, warm, brief. Usually one short sentence, never more than two. No lists, markdown, links or emoji.',
		'Use tools to act: wall for anything the display does, remember only when they clearly want something remembered or done later, play for music, web_search for recent or uncertain facts.',
		"If they're just chatting, chat back. If you can't tell what they want, ask one short question.",
		`Now: ${today}${place ? `, ${place}` : ''}.`
	].join(' ');
}

const fn = (name, description, prop, propDescription) => ({
	type: 'function',
	function: {
		name,
		description,
		parameters: { type: 'object', properties: { [prop]: { type: 'string', description: propDescription } }, required: [prop] }
	}
});

export const TOOLS = {
	wall: fn(
		'wall',
		'Run one display command, said plainly.',
		'command',
		'e.g. "pause", "next song", "volume 30", "turn it down", "set a timer for 10 minutes", "cancel the timer", "show the weather", "what\'s the weather", "what\'s on the wall", "what\'s tomorrow", "I\'m done with the dishes", "snooze the bins for an hour", "screen off", "announce dinner is ready", "undo that"'
	),
	remember: fn('remember', 'Add a chore or reminder to the list.', 'text', 'what and when, e.g. "call mom at 5pm", "take out the bins every Monday at 6pm", "buy milk"'),
	play: fn('play', 'Play music on Apple Music.', 'what', 'e.g. "bohemian rhapsody", "some jazz", "taylor swift", "my workout playlist"'),
	web_search: fn('web_search', 'Search the web.', 'query', 'search words')
};

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

/** The wall ended on a question: the next thing said answers it. */
export function asksBack(say) {
	return /\?["”']?\s*$/.test(String(say || ''));
}
