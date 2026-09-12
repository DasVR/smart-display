import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_SCHEDULE = {
	enabled: true,
	wakeOnPhone: true,
	offAt: '22:30',
	onAt: '06:00',
	phoneWakeAfter: '05:00',
	timeZone: 'America/New_York'
};

const HHMM = /^(\d{1,2}):([0-5]\d)$/;

export function parseHHMM(value) {
	const match = String(value ?? '').trim().match(HHMM);
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23) return null;
	return hour * 60 + minute;
}

export function formatHHMM(minutes) {
	const wrapped = ((Number(minutes) % 1440) + 1440) % 1440;
	const hour = Math.floor(wrapped / 60);
	const minute = wrapped % 60;
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function minutesOfDay(date = new Date(), timeZone = DEFAULT_SCHEDULE.timeZone) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(date);
	let hour = Number(parts.find((part) => part.type === 'hour')?.value);
	const minute = Number(parts.find((part) => part.type === 'minute')?.value);
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
	if (hour === 24) hour = 0;
	return hour * 60 + minute;
}

export function isQuietHours(date, schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.enabled) return false;
	const off = parseHHMM(schedule.offAt);
	const on = parseHHMM(schedule.onAt);
	if (off == null || on == null || off === on) return false;
	const current = minutesOfDay(date, schedule.timeZone || DEFAULT_SCHEDULE.timeZone);
	if (off < on) return current >= off && current < on;
	return current >= off || current < on;
}

export function isPhoneWakeWindow(date, schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.wakeOnPhone) return false;
	if (!isQuietHours(date, schedule)) return false;
	const floor = parseHHMM(schedule.phoneWakeAfter || DEFAULT_SCHEDULE.phoneWakeAfter);
	const on = parseHHMM(schedule.onAt);
	if (floor == null || on == null) return false;
	const current = minutesOfDay(date, schedule.timeZone || DEFAULT_SCHEDULE.timeZone);
	if (floor === on) return false;
	if (floor < on) return current >= floor && current < on;
	return current >= floor || current < on;
}

export function desiredHdmi(date, schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.enabled) return null;
	return isQuietHours(date, schedule) ? 'off' : 'on';
}

/** True when `target` sits in (prev, curr] on a 24h clock, including midnight wrap. */
export function crossedMinute(prevMinutes, currMinutes, target) {
	if (!Number.isFinite(prevMinutes) || !Number.isFinite(currMinutes) || !Number.isFinite(target)) {
		return false;
	}
	if (prevMinutes === currMinutes) return false;
	if (prevMinutes < currMinutes) return target > prevMinutes && target <= currMinutes;
	return target > prevMinutes || target <= currMinutes;
}

export function scheduledAction(prevMinutes, currMinutes, schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.enabled) return null;
	const off = parseHHMM(schedule.offAt);
	const on = parseHHMM(schedule.onAt);
	if (off == null || on == null || off === on) return null;
	const offHit = crossedMinute(prevMinutes, currMinutes, off);
	const onHit = crossedMinute(prevMinutes, currMinutes, on);
	if (offHit && onHit) return currMinutes === on ? 'on' : 'off';
	if (offHit) return 'off';
	if (onHit) return 'on';
	return null;
}

export function normalizeSchedule(input = {}, fallback = DEFAULT_SCHEDULE) {
	const base = { ...DEFAULT_SCHEDULE, ...fallback, ...input };
	const off = parseHHMM(base.offAt);
	const on = parseHHMM(base.onAt);
	const phoneWakeAfter = parseHHMM(base.phoneWakeAfter);
	let timeZone = String(base.timeZone || DEFAULT_SCHEDULE.timeZone).trim() || DEFAULT_SCHEDULE.timeZone;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
	} catch {
		timeZone = fallback.timeZone || DEFAULT_SCHEDULE.timeZone;
	}
	return {
		enabled: base.enabled !== false,
		wakeOnPhone: base.wakeOnPhone !== false,
		offAt: off == null ? fallback.offAt || DEFAULT_SCHEDULE.offAt : formatHHMM(off),
		onAt: on == null ? fallback.onAt || DEFAULT_SCHEDULE.onAt : formatHHMM(on),
		phoneWakeAfter:
			phoneWakeAfter == null
				? fallback.phoneWakeAfter || DEFAULT_SCHEDULE.phoneWakeAfter
				: formatHHMM(phoneWakeAfter),
		timeZone
	};
}

export function envDefaults(env = process.env) {
	const seed = { ...DEFAULT_SCHEDULE };
	if (env.DISPLAY_SCHEDULE === '0' || env.DISPLAY_SCHEDULE === 'false') seed.enabled = false;
	if (env.DISPLAY_WAKE_ON_PHONE === '0' || env.DISPLAY_WAKE_ON_PHONE === 'false') seed.wakeOnPhone = false;
	if (env.DISPLAY_OFF_AT) seed.offAt = env.DISPLAY_OFF_AT;
	if (env.DISPLAY_ON_AT) seed.onAt = env.DISPLAY_ON_AT;
	if (env.DISPLAY_PHONE_WAKE_AFTER) seed.phoneWakeAfter = env.DISPLAY_PHONE_WAKE_AFTER;
	if (env.DISPLAY_TZ) seed.timeZone = env.DISPLAY_TZ;
	else if (env.TZ) seed.timeZone = env.TZ;
	return normalizeSchedule(seed);
}

export function loadSchedule(filePath, env = process.env) {
	const defaults = envDefaults(env);
	if (!filePath || !existsSync(filePath)) return defaults;
	try {
		const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
		return normalizeSchedule(parsed, defaults);
	} catch (error) {
		console.error('display schedule load failed', error.message);
		return defaults;
	}
}

export function saveSchedule(filePath, schedule) {
	const next = normalizeSchedule(schedule);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
	return next;
}
