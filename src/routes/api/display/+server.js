import path from 'node:path';
import { json } from '@sveltejs/kit';
import { PROJECT_ROOT, readHdmiStamp } from '$lib/server/displayPower.js';
import {
	applyDisplayPatch,
	isPhoneWakeWindow,
	isQuietHours,
	loadSchedule,
	nextChange,
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
		next: nextChange(new Date(), schedule),
		hold: null,
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
	const { next, changed } = applyDisplayPatch(current, data);
	if (changed) saveSchedule(SCHEDULE_PATH, normalizeSchedule(next, current));

	return json({ ok: true, ...snapshot() });
}
