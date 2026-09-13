import path from 'node:path';
import { json } from '@sveltejs/kit';
import { PROJECT_ROOT, readHdmiStamp } from '$lib/server/displayPower.js';
import {
	isPhoneWakeWindow,
	isQuietHours,
	loadSchedule,
	normalizeSchedule,
	saveSchedule
} from '$lib/server/displaySchedule.js';

export const prerender = false;

const SCHEDULE_PATH =
	process.env.DISPLAY_SCHEDULE_PATH || path.join(PROJECT_ROOT, 'data/display-schedule.json');

function snapshot() {
	const schedule = loadSchedule(SCHEDULE_PATH);
	const hdmi = readHdmiStamp();
	return {
		hdmi: hdmi === 'on' || hdmi === 'off' ? hdmi : 'unknown',
		schedule,
		quiet: isQuietHours(new Date(), schedule),
		phone: { wakeWindow: isPhoneWakeWindow(new Date(), schedule) }
	};
}

export async function GET() {
	return json(snapshot());
}

export async function POST({ request }) {
	let data;
	try {
		data = await request.json();
	} catch {
		return json({ error: 'invalid payload' }, { status: 400 });
	}

	const current = loadSchedule(SCHEDULE_PATH);
	const next = { ...current };
	if (typeof data.enabled === 'boolean') next.enabled = data.enabled;
	if (typeof data.wakeOnPhone === 'boolean') next.wakeOnPhone = data.wakeOnPhone;
	if (data.offAt) next.offAt = data.offAt;
	if (data.onAt) next.onAt = data.onAt;
	if (data.timeZone) next.timeZone = data.timeZone;
	if (data.phoneWakeAfter) next.phoneWakeAfter = data.phoneWakeAfter;
	if (Array.isArray(data.days) || typeof data.days === 'string') next.days = data.days;
	if (data.schedule && typeof data.schedule === 'object') Object.assign(next, data.schedule);

	const changedSchedule =
		data.enabled !== undefined ||
		data.wakeOnPhone !== undefined ||
		data.offAt ||
		data.onAt ||
		data.timeZone ||
		data.phoneWakeAfter ||
		data.days !== undefined ||
		data.schedule;
	if (changedSchedule) saveSchedule(SCHEDULE_PATH, normalizeSchedule(next, current));

	return json({ ok: true, ...snapshot() });
}
