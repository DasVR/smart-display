import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DAY_INDEX = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6
};

export const DEFAULT_SCHEDULE = {
	enabled: true,
	wakeOnPhone: true,
	offAt: '22:30',
	onAt: '06:00',
	phoneWakeAfter: '05:00',
	timeZone: 'America/New_York',
	days: [...ALL_DAYS],
	// BLE proximity wake: off by default since it needs a device MAC and a
	// distance threshold picked by walking the room with /remote/stats open.
	wakeOnProximity: false,
	proximityDevice: '',
	proximityMeters: 5
};

// HTML <input type="time"> may send HH:MM, HH:MM:SS, or HH:MM:SS.sss.
const HHMM = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

export function parseDay(value) {
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6) {
		return value;
	}
	const raw = String(value ?? '')
		.trim()
		.toLowerCase();
	if (/^[0-6]$/.test(raw)) return Number(raw);
	return DAY_INDEX[raw.slice(0, 3)] ?? null;
}

export function normalizeDays(input, fallback = ALL_DAYS) {
	const fallbackDays = Array.isArray(fallback)
		? [...new Set(fallback.map(parseDay).filter((day) => day != null))].sort((a, b) => a - b)
		: [...ALL_DAYS];
	if (input == null) return fallbackDays;
	let list = input;
	if (typeof input === 'string') list = input.split(/[\s,]+/).filter(Boolean);
	if (!Array.isArray(list)) return fallbackDays;
	if (list.length === 0) return [];
	const out = [];
	for (const item of list) {
		const day = parseDay(item);
		if (day == null || out.includes(day)) continue;
		out.push(day);
	}
	out.sort((a, b) => a - b);
	return out.length ? out : fallbackDays;
}

export function daysEqual(a, b) {
	const left = normalizeDays(a, []);
	const right = normalizeDays(b, []);
	return left.length === right.length && left.every((day, i) => day === right[i]);
}

export function formatDaysLabel(days) {
	const normalized = days == null ? [...ALL_DAYS] : normalizeDays(days, []);
	if (normalized.length === 7) return '';
	if (normalized.length === 0) return 'no days';
	return normalized.map((day) => DAY_LABELS[day]).join(' ');
}

export function weekdayInZone(date = new Date(), timeZone = DEFAULT_SCHEDULE.timeZone) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		weekday: 'short'
	}).formatToParts(date);
	const raw = (parts.find((part) => part.type === 'weekday')?.value || '').slice(0, 3).toLowerCase();
	return DAY_INDEX[raw] ?? 0;
}

/** Which night owns this instant. Overnight mornings belong to the previous weekday. */
export function nightOwnerWeekday(date, schedule = DEFAULT_SCHEDULE) {
	const tz = schedule.timeZone || DEFAULT_SCHEDULE.timeZone;
	const off = parseHHMM(schedule.offAt);
	const on = parseHHMM(schedule.onAt);
	const weekday = weekdayInZone(date, tz);
	if (off == null || on == null || off <= on) return weekday;
	const current = minutesOfDay(date, tz);
	if (current <= on) return (weekday + 6) % 7;
	return weekday;
}

export function scheduledDays(schedule = DEFAULT_SCHEDULE) {
	return schedule?.days == null ? [...ALL_DAYS] : normalizeDays(schedule.days, ALL_DAYS);
}

export function isNightScheduled(date, schedule = DEFAULT_SCHEDULE) {
	const days = scheduledDays(schedule);
	if (!days.length) return false;
	return days.includes(nightOwnerWeekday(date, schedule));
}

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
	if (!isNightScheduled(date, schedule)) return false;
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

export function scheduledAction(prevMinutes, currMinutes, schedule = DEFAULT_SCHEDULE, date = new Date()) {
	if (!schedule?.enabled) return null;
	const off = parseHHMM(schedule.offAt);
	const on = parseHHMM(schedule.onAt);
	if (off == null || on == null || off === on) return null;
	const offHit = crossedMinute(prevMinutes, currMinutes, off);
	const onHit = crossedMinute(prevMinutes, currMinutes, on);
	if (!isNightScheduled(date, schedule)) return null;
	if (offHit && onHit) return currMinutes === on ? 'on' : 'off';
	if (offHit) return 'off';
	if (onHit) return 'on';
	return null;
}

function windowFieldsChanged(prev, next) {
	return (
		prev.offAt !== next.offAt ||
		prev.onAt !== next.onAt ||
		prev.timeZone !== next.timeZone ||
		!daysEqual(prev.days, next.days)
	);
}

/**
 * One schedule poll. Boot (`lastMinutes == null`) follows the window unless
 * a manual/wake hold is in effect. Later polls only fire at off/on boundaries;
 * a hold lasts until that next alarm, then the schedule owns the panel again.
 */
export function scheduleTick({ lastMinutes, hold, schedule = DEFAULT_SCHEDULE, date = new Date() } = {}) {
	const curr = minutesOfDay(date, schedule.timeZone || DEFAULT_SCHEDULE.timeZone);
	if (lastMinutes == null) {
		return {
			lastMinutes: curr,
			hold: hold || null,
			action: hold ? null : desiredHdmi(date, schedule)
		};
	}
	const action = scheduledAction(lastMinutes, curr, schedule, date);
	return {
		lastMinutes: curr,
		hold: action ? null : hold || null,
		action
	};
}

/**
 * What to do after a schedule save. Manual power and phone/proximity wake
 * must survive proximity/day tweaks; flipping Auto on/off is an explicit
 * "follow this now" gesture and clears the hold.
 */
export function schedulePatchAction(prev, next, { hold, date = new Date() } = {}) {
	const wasEnabled = prev?.enabled !== false;
	const enabled = next?.enabled !== false;
	if (wasEnabled && !enabled) {
		return { action: 'on', hold: null };
	}
	if (!enabled) {
		return { action: null, hold: hold || null };
	}
	if (!wasEnabled && enabled) {
		return { action: desiredHdmi(date, next), hold: null };
	}
	if (!windowFieldsChanged(prev, next)) {
		return { action: null, hold: hold || null };
	}
	if (hold) {
		return { action: null, hold };
	}
	return { action: desiredHdmi(date, next), hold: null };
}

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

/** Smooths a noisy boolean (RSSI-derived "is it near?" readings jitter
 *  between polls) so a single stray reading doesn't wake or fail to wake the
 *  panel. `state` is a small object the caller keeps across polls; the same
 *  raw reading has to repeat `confirm` times in a row before the confirmed
 *  value moves. */
export function debounceSignal(state = {}, raw, confirm = 2) {
	const value = Boolean(raw);
	const streak = state.raw === value ? (state.streak || 0) + 1 : 1;
	state.raw = value;
	state.streak = streak;
	if (streak >= confirm) state.confirmed = value;
	else if (state.confirmed === undefined) state.confirmed = false;
	return state.confirmed;
}

export function normalizeProximityMeters(value, fallback = DEFAULT_SCHEDULE.proximityMeters) {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(30, Math.round(n * 10) / 10);
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
	const fallbackDays = fallback.days == null ? ALL_DAYS : fallback.days;
	const proximityDevice = String(base.proximityDevice ?? '').trim();
	return {
		enabled: base.enabled !== false,
		wakeOnPhone: base.wakeOnPhone !== false,
		offAt: off == null ? fallback.offAt || DEFAULT_SCHEDULE.offAt : formatHHMM(off),
		onAt: on == null ? fallback.onAt || DEFAULT_SCHEDULE.onAt : formatHHMM(on),
		phoneWakeAfter:
			phoneWakeAfter == null
				? fallback.phoneWakeAfter || DEFAULT_SCHEDULE.phoneWakeAfter
				: formatHHMM(phoneWakeAfter),
		timeZone,
		days: normalizeDays(base.days, fallbackDays),
		wakeOnProximity: base.wakeOnProximity === true,
		proximityDevice: MAC_RE.test(proximityDevice) ? proximityDevice.toUpperCase() : '',
		proximityMeters: normalizeProximityMeters(
			base.proximityMeters,
			fallback.proximityMeters || DEFAULT_SCHEDULE.proximityMeters
		)
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
	if (env.DISPLAY_SCHEDULE_DAYS) seed.days = env.DISPLAY_SCHEDULE_DAYS;
	if (env.DISPLAY_WAKE_ON_PROXIMITY === '1' || env.DISPLAY_WAKE_ON_PROXIMITY === 'true') {
		seed.wakeOnProximity = true;
	}
	if (env.DISPLAY_PROXIMITY_DEVICE) seed.proximityDevice = env.DISPLAY_PROXIMITY_DEVICE;
	if (env.DISPLAY_PROXIMITY_METERS) seed.proximityMeters = env.DISPLAY_PROXIMITY_METERS;
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
