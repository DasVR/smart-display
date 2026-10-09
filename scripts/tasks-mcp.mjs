#!/usr/bin/env node
/**
 * MCP bridge for the display's chores / jobs / alerts.
 *
 * Lets any MCP-capable assistant (Claude, an agent runtime, Tomo, Instinct…)
 * read and change the display's task list and post to its Dynamic Island.
 * It is a thin stdio JSON-RPC server over the HTTP API in
 * src/lib/server/taskHub.js, with no dependencies, so it runs anywhere Node
 * 18+ can reach the display.
 *
 *   DISPLAY_URL        where the display lives   (default http://localhost:3000)
 *   DISPLAY_API_TOKEN  bearer token, if the display has one set
 *   DISPLAY_SOURCE     name shown on items this assistant adds (default "Assistant")
 *
 * Example client config:
 *   { "command": "node", "args": ["/path/to/smart-display/scripts/tasks-mcp.mjs"],
 *     "env": { "DISPLAY_URL": "http://kiosk.local:3000", "DISPLAY_SOURCE": "Tomo" } }
 */
import { createInterface } from 'node:readline';

const BASE = (process.env.DISPLAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.DISPLAY_API_TOKEN || '';
const SOURCE = process.env.DISPLAY_SOURCE || 'Assistant';
const PROTOCOL = '2025-06-18';

const repeatSchema = {
	description:
		'Omit for one-off. Shorthand "hourly" | "daily" | "weekly" | "monthly", or { freq, interval?, days? } where days are weekdays 0-6 (0 = Sunday) for weekly rules.',
	anyOf: [
		{ type: 'string', enum: ['none', 'hourly', 'daily', 'weekly', 'monthly'] },
		{
			type: 'object',
			properties: {
				freq: { type: 'string', enum: ['hourly', 'daily', 'weekly', 'monthly'] },
				interval: { type: 'integer', minimum: 1 },
				days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } }
			},
			required: ['freq']
		}
	]
};

const TOOLS = [
	{
		name: 'list_tasks',
		description:
			"List the display's chores and alerts, most urgent first. Each has a status: overdue, due, today, snoozed, upcoming or done.",
		inputSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', description: 'Comma-separated statuses to keep, e.g. "overdue,today"' },
				kind: { type: 'string', enum: ['chore', 'alert'] }
			}
		}
	},
	{
		name: 'add_task',
		description:
			'Add a chore (stays on the display until marked done) or an alert (pops up on the display at its time, then moves on).',
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'Short, readable from across a room' },
				kind: { type: 'string', enum: ['chore', 'alert'], default: 'chore' },
				at: { type: 'string', description: 'ISO 8601 date-time of the first occurrence; defaults to now' },
				repeat: repeatSchema,
				notes: { type: 'string' },
				severity: { type: 'string', enum: ['info', 'ok', 'warn', 'error'] }
			},
			required: ['title']
		}
	},
	{
		name: 'update_task',
		description: 'Change any field of an existing task. Changing at or repeat restarts its schedule.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				title: { type: 'string' },
				kind: { type: 'string', enum: ['chore', 'alert'] },
				at: { type: 'string' },
				repeat: repeatSchema,
				notes: { type: 'string' },
				severity: { type: 'string', enum: ['info', 'ok', 'warn', 'error'] },
				active: { type: 'boolean' }
			},
			required: ['id']
		}
	},
	{
		name: 'complete_task',
		description: 'Mark a chore done (or dismiss an alert). Repeating items move to their next time.',
		inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
	},
	{
		name: 'snooze_task',
		description: 'Push a task back without changing its schedule.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, minutes: { type: 'integer', minimum: 1, default: 15 } },
			required: ['id']
		}
	},
	{
		name: 'delete_task',
		description: 'Remove a task for good.',
		inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
	},
	{
		name: 'notify_display',
		description: "Show a one-off message in the display's Dynamic Island right now (no task is stored).",
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string' },
				body: { type: 'string' },
				severity: { type: 'string', enum: ['info', 'ok', 'warn', 'error'] }
			},
			required: ['title']
		}
	}
];

async function api(method, path, body) {
	const headers = { 'Content-Type': 'application/json' };
	if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
	const res = await fetch(BASE + path, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(8000)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || `display answered ${res.status}`);
	return data;
}

const enc = encodeURIComponent;

async function callTool(name, args = {}) {
	switch (name) {
		case 'list_tasks': {
			const q = new URLSearchParams();
			if (args.status) q.set('status', args.status);
			if (args.kind) q.set('kind', args.kind);
			return api('GET', `/api/tasks${q.size ? `?${q}` : ''}`);
		}
		case 'add_task':
			return api('POST', '/api/tasks', { source: SOURCE, ...args });
		case 'update_task': {
			const { id, ...rest } = args;
			return api('PATCH', `/api/tasks/${enc(id)}`, rest);
		}
		case 'complete_task':
			return api('POST', `/api/tasks/${enc(args.id)}/done`);
		case 'snooze_task':
			return api('POST', `/api/tasks/${enc(args.id)}/snooze`, { minutes: args.minutes ?? 15 });
		case 'delete_task':
			return api('DELETE', `/api/tasks/${enc(args.id)}`);
		case 'notify_display':
			return api('POST', '/api/notify', { source: SOURCE, ...args });
		default:
			throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
	}
}

function write(msg) {
	process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg) {
	const { id, method, params } = msg;
	const isRequest = id !== undefined && id !== null;
	try {
		if (method === 'initialize') {
			return write({
				jsonrpc: '2.0',
				id,
				result: {
					protocolVersion: params?.protocolVersion || PROTOCOL,
					capabilities: { tools: {} },
					serverInfo: { name: 'smart-display-tasks', version: '1.0.0' },
					instructions:
						'Chores, little jobs and alerts on a wall display. Chores stay until marked done; alerts pop up at their time. Use ISO times in the display owner\'s local time zone.'
				}
			});
		}
		if (method === 'ping') return write({ jsonrpc: '2.0', id, result: {} });
		if (method === 'tools/list') return write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
		if (method === 'tools/call') {
			try {
				const data = await callTool(params?.name, params?.arguments);
				return write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } });
			} catch (err) {
				if (err.code === -32602) throw err;
				// tool-level failure: report it to the model, not as a protocol error
				return write({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: err.message }] } });
			}
		}
		if (!isRequest) return; // notifications such as notifications/initialized
		write({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
	} catch (err) {
		if (isRequest) write({ jsonrpc: '2.0', id, error: { code: err.code || -32603, message: err.message } });
	}
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
	if (!line.trim()) return;
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
	}
	handle(msg);
});
