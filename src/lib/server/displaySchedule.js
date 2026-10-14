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

/**
 * When the panel is on, per day of the week (on the wall's clock).
 *
 *   mode 'times'  on at `on`, off at `off`. An off time at or before the on
 *                 time means the next morning: Friday on 07:00, off 01:00
 *                 stays on until 1 AM Saturday.
 *   mode 'on'     on all day (midnight to midnight)
 *   mode 'off'    off all day
 *
 * Index 0 is Sunday. The panel is on whenever today's window or the tail of
 * yesterday's (an after-midnight off) covers now.
 */
export const DAY_MODES = ['times', 'on', 'off'];
const DEFAULT_DAY = { mode: 'times', on: '06:00', off: '22:30' };

export const DEFAULT_SCHEDULE = {
	enabled: true,
	wakeOnPhone: true,
	week: ALL_DAYS.map(() => ({ ...DEFAULT_DAY })),
	phoneWakeAfter: '05:00',
	timeZone: 'America/New_York'
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

/* ---------- the week ---------- */

/** One day's settings, cleaned up. Equal on and off times mean on all day. */
export function normalizeDay(input = {}, fallback = DEFAULT_DAY) {
	const mode = DAY_MODES.includes(input?.mode) ? input.mode : DAY_MODES.includes(fallback?.mode) ? fallback.mode : 'times';
	const on = parseHHMM(input?.on) ?? parseHHMM(fallback?.on) ?? parseHHMM(DEFAULT_DAY.on);
	const off = parseHHMM(input?.off) ?? parseHHMM(fallback?.off) ?? parseHHMM(DEFAULT_DAY.off);
	return { mode: mode === 'times' && on === off ? 'on' : mode, on: formatHHMM(on), off: formatHHMM(off) };
}

export function normalizeWeek(input, fallback = DEFAULT_SCHEDULE.week) {
	const base = Array.isArray(fallback) && fallback.length === 7 ? fallback : DEFAULT_SCHEDULE.week;
	if (!Array.isArray(input)) return base.map((d) => normalizeDay(d));
	return ALL_DAYS.map((i) => normalizeDay(input[i] ?? base[i], base[i]));
}

/**
 * The old single window ({ offAt, onAt, days: nights it applies to }) as a
 * week. A night in `days` turns off at offAt that evening and back on at
 * onAt the next morning; a night that isn't stays on straight through.
 */
export function weekFromLegacy({ offAt = '22:30', onAt = '06:00', days = ALL_DAYS } = {}) {
	const nights = normalizeDays(days, ALL_DAYS);
	const on = formatHHMM(parseHHMM(onAt) ?? parseHHMM('06:00'));
	const off = formatHHMM(parseHHMM(offAt) ?? parseHHMM('22:30'));
	return ALL_DAYS.map((d) => {
		const morning = nights.includes((d + 6) % 7) ? on : '00:00'; // last night was off: on from midnight
		const evening = nights.includes(d) ? off : '00:00'; // tonight isn't: on until midnight
		return normalizeDay({ mode: 'times', on: morning, off: evening });
	});
}

/** Is `minutes` (on the wall's clock, day `weekday`) inside the awake time? */
function awakeAt(week, weekday, minutes) {
	const today = week[weekday];
	const yesterday = week[(weekday + 6) % 7];
	if (today.mode === 'on') return true;
	if (today.mode === 'times') {
		const on = parseHHMM(today.on);
		const off = parseHHMM(today.off);
		if (off > on ? minutes >= on && minutes < off : minutes >= on) return true;
	}
	// yesterday ran past midnight
	if (yesterday.mode === 'times') {
		const on = parseHHMM(yesterday.on);
		const off = parseHHMM(yesterday.off);
		if (off <= on && minutes < off) return true;
	}
	return false;
}

function zoneOf(schedule) {
	return schedule?.timeZone || DEFAULT_SCHEDULE.timeZone;
}

/** The week of a schedule, read through the old single window if that's all it has. */
function weekOf(schedule) {
	if (Array.isArray(schedule?.week)) return normalizeWeek(schedule.week);
	if (schedule && (schedule.offAt || schedule.onAt || schedule.days !== undefined)) return weekFromLegacy(schedule);
	return normalizeWeek();
}

/** Should the panel be on at this instant? (ignores `enabled`) */
export function isAwake(date, schedule = DEFAULT_SCHEDULE) {
	const tz = zoneOf(schedule);
	return awakeAt(weekOf(schedule), weekdayInZone(date, tz), minutesOfDay(date, tz));
}

export function isQuietHours(date, schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.enabled) return false;
	return !isAwake(date, schedule);
}

/**
 * The phone may wake the panel early: in the off time, after phoneWakeAfter,
 * and before today's on time (or before noon on a day that's off all day).
 */
export function isPhoneWakeWindow(date, schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.wakeOnPhone) return false;
	if (!isQuietHours(date, schedule)) return false;
	const tz = zoneOf(schedule);
	const floor = parseHHMM(schedule.phoneWakeAfter || DEFAULT_SCHEDULE.phoneWakeAfter);
	if (floor == null) return false;
	const today = weekOf(schedule)[weekdayInZone(date, tz)];
	const until = today.mode === 'times' ? parseHHMM(today.on) : 12 * 60;
	const current = minutesOfDay(date, tz);
	return floor < until && current >= floor && current < until;
}

export function desiredHdmi(date, schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.enabled) return null;
	return isAwake(date, schedule) ? 'on' : 'off';
}

/**
 * When the panel next changes by itself: { at (ISO), to: 'on' | 'off' }, or
 * null when nothing changes in the next 8 days (all on, all off, or the
 * schedule is paused). Steps a quarter hour at a time, then finds the minute.
 */
export function nextChange(date = new Date(), schedule = DEFAULT_SCHEDULE) {
	if (!schedule?.enabled) return null;
	const start = Math.floor(date.getTime() / 60000) * 60000;
	const now = isAwake(new Date(start), schedule);
	const STEP = 15 * 60000;
	for (let t = start + STEP; t <= start + 8 * 86400000; t += STEP) {
		if (isAwake(new Date(t), schedule) === now) continue;
		let at = t - STEP + 60000;
		while (at < t && isAwake(new Date(at), schedule) === now) at += 60000;
		return { at: new Date(at).toISOString(), to: now ? 'off' : 'on' };
	}
	return null;
}

/**
 * One schedule check, run every minute or so. It works out whether the panel
 * should be on right now, so a restart, a missed minute or a daylight-saving
 * jump can't leave it wrong. A hand-made change (hold) lasts until the
 * schedule next changes its mind, then the schedule owns the panel again.
 */
export function scheduleTick({ lastDesired, hold, schedule = DEFAULT_SCHEDULE, date = new Date() } = {}) {
	const desired = desiredHdmi(date, schedule);
	if (lastDesired == null) {
		return { lastDesired: desired, hold: hold || null, action: hold ? null : desired };
	}
	if (desired && desired !== lastDesired) {
		return { lastDesired: desired, hold: null, action: desired };
	}
	return { lastDesired: desired, hold: hold || null, action: null };
}

function windowFieldsChanged(prev, next) {
	return prev.timeZone !== next.timeZone || JSON.stringify(weekOf(prev)) !== JSON.stringify(weekOf(next));
}

/**
 * What to do after a schedule save. Manual power and the morning wake
 * survive any edit (a hand-made change holds until the schedule next changes
 * its mind); flipping Auto on/off is an explicit "follow this now" gesture
 * and clears the hold.
 */
export function schedulePatchAction(prev, next, { hold, date = new Date() } = {}) {
	const wasEnabled = prev?.enabled !== false;
	const enabled = next?.enabled !== false;
	if (wasEnabled && !enabled) return { action: 'on', hold: null };
	if (!enabled) return { action: null, hold: hold || null };
	if (!wasEnabled && enabled) return { action: desiredHdmi(date, next), hold: null };
	if (!windowFieldsChanged(prev, next)) return { action: null, hold: hold || null };
	if (hold) return { action: null, hold };
	return { action: desiredHdmi(date, next), hold: null };
}

/**
 * Fold a POST /api/display body into the schedule. Understands the week
 * ({ week: [...] }), one day ({ day: 5, mode, on, off }), copying a day
 * ({ copyDay: 1, to: 'weekdays' | 'weekend' | 'all' | [days] }), and the old
 * single window ({ offAt, onAt, days }), which sets every day.
 * Returns { next, changed }.
 */
export function applyDisplayPatch(current, data = {}) {
	const next = { ...current, week: weekOf(current) };
	let changed = false;
	const set = (key, value) => {
		next[key] = value;
		changed = true;
	};
	if (typeof data.enabled === 'boolean') set('enabled', data.enabled);
	if (typeof data.wakeOnPhone === 'boolean') set('wakeOnPhone', data.wakeOnPhone);
	if (data.timeZone) set('timeZone', data.timeZone);
	if (data.phoneWakeAfter) set('phoneWakeAfter', data.phoneWakeAfter);
	if (data.schedule && typeof data.schedule === 'object') {
		for (const [k, v] of Object.entries(data.schedule)) set(k, v);
	}
	if (Array.isArray(data.week)) set('week', normalizeWeek(data.week, next.week));
	const day = parseDay(data.day);
	if (day != null) {
		const week = [...next.week];
		week[day] = normalizeDay({ ...week[day], ...pick(data, ['mode', 'on', 'off']) }, week[day]);
		set('week', week);
	}
	const from = parseDay(data.copyDay);
	if (from != null) {
		const targets = data.to === 'weekdays' ? [1, 2, 3, 4, 5] : data.to === 'weekend' ? [0, 6] : data.to === 'all' ? ALL_DAYS : normalizeDays(data.to, []);
		set('week', next.week.map((d, i) => (targets.includes(i) ? { ...next.week[from] } : d)));
	}
	if (data.offAt || data.onAt || data.days !== undefined) {
		// the old single window: every day gets it
		set('week', weekFromLegacy({ offAt: data.offAt ?? next.week[1].off, onAt: data.onAt ?? next.week[1].on, days: data.days ?? ALL_DAYS }));
	}
	return { next, changed };
}

function pick(obj, keys) {
	const out = {};
	for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
	return out;
}

/** "7 AM", "10:30 PM" */
export function clock12(hhmm) {
	const m = parseHHMM(hhmm) ?? 0;
	const h = Math.floor(m / 60);
	const min = m % 60;
	return `${h % 12 || 12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Mon–Fri 6 AM–10:30 PM · Sat, Sun 8 AM–12:30 AM", for notices and logs. */
export function describeWeek(week) {
	const days = normalizeWeek(week);
	const text = (d) => (d.mode === 'on' ? 'on all day' : d.mode === 'off' ? 'off all day' : `${clock12(d.on)}–${clock12(d.off)}`);
	const groups = [];
	for (const i of [1, 2, 3, 4, 5, 6, 0]) {
		const t = text(days[i]);
		const last = groups.at(-1);
		if (last && last.text === t) last.days.push(i);
		else groups.push({ text: t, days: [i] });
	}
	return groups
		.map((g) => {
			const names = g.days.map((d) => DAY_LABELS[d]);
			const label = g.days.length === 7 ? 'Every day' : g.days.length > 2 ? `${names[0]}–${names.at(-1)}` : names.join(', ');
			return `${label} ${g.text}`;
		})
		.join(' · ');
}

export function normalizeSchedule(input = {}, fallback = DEFAULT_SCHEDULE) {
	const base = { ...DEFAULT_SCHEDULE, ...fallback, ...input };
	const phoneWakeAfter = parseHHMM(base.phoneWakeAfter);
	let timeZone = String(base.timeZone || DEFAULT_SCHEDULE.timeZone).trim() || DEFAULT_SCHEDULE.timeZone;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
	} catch {
		timeZone = fallback.timeZone || DEFAULT_SCHEDULE.timeZone;
	}
	// a file (or env) from before per-day times: carry its single window over
	const legacy = !Array.isArray(input.week) && (input.offAt || input.onAt || input.days !== undefined);
	const week = legacy ? weekFromLegacy(input) : normalizeWeek(input.week ?? fallback.week, fallback.week);
	// an old file's Bluetooth proximity fields (wakeOnProximity, proximityDevice,
	// proximityMeters) drop off here: the webcam took that job (docs/senses.md)
	return {
		enabled: base.enabled !== false,
		wakeOnPhone: base.wakeOnPhone !== false,
		week,
		phoneWakeAfter:
			phoneWakeAfter == null
				? fallback.phoneWakeAfter || DEFAULT_SCHEDULE.phoneWakeAfter
				: formatHHMM(phoneWakeAfter),
		timeZone
	};
}

export function envDefaults(env = process.env) {
	// no week in the seed: the old single-window variables (DISPLAY_OFF_AT,
	// DISPLAY_ON_AT, DISPLAY_SCHEDULE_DAYS) become one; DISPLAY_WEEK (JSON) wins
	const { week: _defaultWeek, ...seed } = DEFAULT_SCHEDULE;
	if (env.DISPLAY_SCHEDULE === '0' || env.DISPLAY_SCHEDULE === 'false') seed.enabled = false;
	if (env.DISPLAY_WAKE_ON_PHONE === '0' || env.DISPLAY_WAKE_ON_PHONE === 'false') seed.wakeOnPhone = false;
	if (env.DISPLAY_OFF_AT) seed.offAt = env.DISPLAY_OFF_AT;
	if (env.DISPLAY_ON_AT) seed.onAt = env.DISPLAY_ON_AT;
	if (env.DISPLAY_SCHEDULE_DAYS) seed.days = env.DISPLAY_SCHEDULE_DAYS;
	if (env.DISPLAY_WEEK) {
		try {
			seed.week = JSON.parse(env.DISPLAY_WEEK);
		} catch {
			/* not JSON: keep the default week */
		}
	}
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
