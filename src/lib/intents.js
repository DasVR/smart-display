/**
 * Everything the wall can be asked to do, declared once.
 *
 * Each intent names what it does, how people say it, and what it takes. The
 * rest is generated from this list instead of being written again in each
 * place:
 *  - GET /api/action/intents and POST /api/action/intent (actionHub)
 *  - the MCP bridge's run_wall_intent tool (scripts/tasks-mcp.mjs)
 *  - the phone's "Everything you can say" list (remote/shortcuts)
 *
 * The phrases still go through parseCommand (src/lib/wallActions.js), and
 * tests/intents.test.mjs checks that every example below parses to its own
 * intent, so this list and the parser can't drift apart.
 *
 * Pure.
 */

import { KIOSK_VIEWS } from './kioskViews.js';

/** The groups, in the order the phone shows them. */
export const INTENT_GROUPS = ['Ask', 'Your list', 'The wall', 'Music', 'Agents'];

/**
 * id: what actionHub runs. label: one line for a person. examples: real
 * phrasings (each must parse to this id unless `ringing` is set). params: a
 * small JSON-schema per parameter. ringing: only understood while the wall
 * is calling for attention.
 */
export const INTENTS = [
	{ id: 'brief', group: 'Ask', label: "Read out what's waiting", examples: ["what's on the wall", 'read me the list', 'brief'] },
	{ id: 'tomorrow', group: 'Ask', label: "Read out tomorrow's list", examples: ['what do I have tomorrow', "tomorrow's list"] },
	{ id: 'weather', group: 'Ask', label: 'Say the weather', examples: ['will it rain', "what's the weather", 'do I need an umbrella'] },
	{ id: 'time', group: 'Ask', label: 'Say the time', examples: ['what time is it'] },
	{ id: 'date', group: 'Ask', label: 'Say the date', examples: ['what day is it'] },
	{ id: 'board', group: 'Ask', label: 'Read the departure board', examples: ["I'm leaving", 'read me the board'] },
	{ id: 'timer-left', group: 'Ask', label: 'Say how long is left on the timers', examples: ['how long is left on the timer'] },
	{ id: 'help', group: 'Ask', label: 'List what you can say', examples: ['help', 'what can you do'] },
	{ id: 'repeat', group: 'Ask', label: 'Say the last answer again', examples: ['say that again'] },

	{
		id: 'done',
		group: 'Your list',
		label: 'Tick off a chore',
		examples: ["I'm done with the bins", 'mark feed the cat as done', 'the dishes are done'],
		params: { query: { type: 'string', description: 'Part of the chore\'s name; empty for the most urgent one' } }
	},
	{
		id: 'snooze',
		group: 'Your list',
		label: 'Snooze a chore or alert',
		examples: ['snooze the bins for an hour', 'snooze feed the cat for 20 minutes'],
		params: {
			query: { type: 'string', description: "Part of the item's name" },
			minutes: { type: 'integer', minimum: 1, maximum: 10080, default: 60 }
		}
	},
	{ id: 'undo', group: 'Your list', label: 'Undo the last add, tick-off or snooze', examples: ['undo that', 'scratch that'] },
	{ id: 'cancel-timer', group: 'Your list', label: 'Cancel the timers', examples: ['cancel the timer'] },
	{
		id: 'ack',
		group: 'Your list',
		label: "Answer what's ringing",
		examples: ['got it', 'okay'],
		ringing: true,
		params: { all: { type: 'boolean', description: 'Answer everything that is ringing', default: false } }
	},

	{
		id: 'announce',
		group: 'The wall',
		label: 'Say something out loud on the wall',
		examples: ['announce dinner is ready', "tell everyone we're leaving"],
		params: { text: { type: 'string', description: 'What to say' } },
		required: ['text']
	},
	{
		id: 'show',
		group: 'The wall',
		label: 'Show a view',
		examples: ['show the weather', 'go to the calendar', 'open music'],
		params: { view: { type: 'string', enum: KIOSK_VIEWS } },
		required: ['view']
	},
	{
		id: 'screen',
		group: 'The wall',
		label: 'Turn the screen on or off',
		examples: ['screen off', 'good night', 'good morning'],
		params: { state: { type: 'string', enum: ['on', 'off'] } },
		required: ['state']
	},
	{
		id: 'volume',
		group: 'The wall',
		label: 'Change the volume',
		examples: ['turn it up', 'volume down', 'set the volume to 40', 'mute'],
		params: {
			change: { type: 'string', enum: ['up', 'down', 'set', 'mute', 'unmute'] },
			level: { type: 'integer', minimum: 0, maximum: 100, description: "For change: 'set'" },
			big: { type: 'boolean', description: 'A bigger step up or down' }
		},
		required: ['change']
	},

	{ id: 'now-playing', group: 'Music', label: "Say what's playing", examples: ['what song is this'] },
	{
		id: 'music',
		group: 'Music',
		label: 'Play, pause or skip',
		examples: ['pause the music', 'play', 'next song', 'previous track'],
		params: { action: { type: 'string', enum: ['play', 'pause', 'next', 'previous'] } },
		required: ['action']
	},

	{
		id: 'approval',
		group: 'Agents',
		label: "Answer an agent that's waiting",
		examples: ['allow', 'deny it'],
		params: { decision: { type: 'string', enum: ['allow', 'deny'] } },
		required: ['decision']
	}
];

const BY_ID = new Map(INTENTS.map((i) => [i.id, i]));

export function intentById(id) {
	return BY_ID.get(String(id ?? '')) ?? null;
}

function checkParam(name, schema, value) {
	if (schema.type === 'string') {
		if (typeof value !== 'string') return `${name} must be text`;
		if (schema.enum && !schema.enum.includes(value)) return `${name} must be one of ${schema.enum.join(', ')}`;
		return null;
	}
	if (schema.type === 'integer') {
		if (!Number.isInteger(value)) return `${name} must be a whole number`;
		if (schema.minimum !== undefined && value < schema.minimum) return `${name} must be at least ${schema.minimum}`;
		if (schema.maximum !== undefined && value > schema.maximum) return `${name} must be at most ${schema.maximum}`;
		return null;
	}
	if (schema.type === 'boolean') return typeof value === 'boolean' ? null : `${name} must be true or false`;
	return null;
}

/**
 * Turn { id, params } from an API caller into the action actionHub runs.
 * Returns { action } or { error }. Unknown params are dropped, defaults
 * filled in, so a caller can't smuggle in fields the parser never makes.
 */
export function resolveIntent(id, params = {}) {
	const intent = intentById(id);
	if (!intent) return { error: `unknown intent ${JSON.stringify(String(id ?? ''))}` };
	const action = { intent: intent.id };
	const p = params && typeof params === 'object' ? params : {};
	for (const name of intent.required ?? []) {
		if (p[name] === undefined || p[name] === '') return { error: `${intent.id} needs ${name}` };
	}
	for (const [name, schema] of Object.entries(intent.params ?? {})) {
		const value = p[name] ?? schema.default;
		if (value === undefined) continue;
		const err = checkParam(name, schema, value);
		if (err) return { error: err };
		action[name] = value;
	}
	if (action.intent === 'done' || action.intent === 'snooze') action.query = action.query ?? '';
	return { action };
}

/** The list as plain data: for the API, the phone and docs. */
export function describeIntents() {
	return INTENTS.map(({ id, group, label, examples, params, required, ringing }) => ({
		id,
		group,
		label,
		examples: [...examples],
		params: params ? structuredClone(params) : {},
		required: [...(required ?? [])],
		...(ringing ? { ringing: true } : {})
	}));
}

/** Grouped for display, groups in INTENT_GROUPS order. */
export function groupedIntents() {
	return INTENT_GROUPS.map((group) => ({ group, intents: describeIntents().filter((i) => i.group === group) })).filter((g) => g.intents.length);
}

/** One MCP tool that can run any intent, its schema generated from the list. */
export function intentTool() {
	const lines = INTENTS.map((i) => {
		const ps = Object.keys(i.params ?? {});
		return `- ${i.id}: ${i.label}${ps.length ? ` (params: ${ps.join(', ')})` : ''}`;
	});
	return {
		name: 'run_wall_intent',
		description: `Do something on the wall, the same as saying it to the wall. Intents:\n${lines.join('\n')}\nReturns what the wall said back.`,
		inputSchema: {
			type: 'object',
			properties: {
				intent: { type: 'string', enum: INTENTS.map((i) => i.id) },
				params: { type: 'object', description: 'Parameters for the intent, see the list above' }
			},
			required: ['intent']
		}
	};
}
