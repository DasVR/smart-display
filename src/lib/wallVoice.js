// What the wall says out loud, and when it stays quiet. Pure helpers shared
// by the server (src/lib/server/voiceHub.js) and the tests.

import { DISPLAY_TZ } from './atmosphere.js';

export const DEFAULT_VOICE = {
	enabled: true,
	// "George", one of ElevenLabs' default voices: warm, clear, British.
	voiceId: 'JBFqnCBsd6RMkjVDRZzb',
	// Flash is the fast, cheap model (half a credit per character).
	model: 'eleven_flash_v2_5',
	// night, on the wall's clock: the voice speaks softer (or not at all, with nightSilent)
	quietStart: '22:00',
	quietEnd: '07:00',
	// how loud the voice is, as a share of the speaker's volume. Only the voice:
	// music, sound effects and the speaker volume itself are left alone.
	dayVolume: 0.5,
	nightVolume: 0.22,
	// the old behaviour: say nothing at night (urgent things still speak)
	nightSilent: false,
	// with the webcam on (docs/senses.md): louder across the room, softer up
	// close and when you're lying down at night
	followRoom: true,
	// with the webcam on: nothing said to an empty room; it's said when someone comes back
	holdWhenAway: true,
	// Characters sent to ElevenLabs per day. Cached phrases are free, so
	// this is only new sentences. Creator is 100k credits a month.
	dailyChars: 3000
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm) {
	const m = HHMM.exec(String(hhmm || ''));
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes past midnight on the wall's clock. */
export function wallMinutes(ms, tz = DISPLAY_TZ) {
	const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: tz }).formatToParts(new Date(ms));
	const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
	const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
	return (h % 24) * 60 + m;
}

/** True inside quiet hours. The window may wrap midnight (22:00 to 07:00). */
export function inQuietHours(ms, { quietStart, quietEnd } = DEFAULT_VOICE, tz = DISPLAY_TZ) {
	const a = minutesOf(quietStart);
	const b = minutesOf(quietEnd);
	if (a === null || b === null || a === b) return false;
	const now = wallMinutes(ms, tz);
	return a < b ? now >= a && now < b : now >= a || now < b;
}

/** How loud the voice speaks right now: the night volume inside the night window, the day volume outside it. */
export function voiceVolumeAt(ms, settings = DEFAULT_VOICE, tz = DISPLAY_TZ) {
	return inQuietHours(ms, settings, tz) ? settings.nightVolume ?? DEFAULT_VOICE.nightVolume : settings.dayVolume ?? DEFAULT_VOICE.dayVolume;
}

/** Text that is safe and short enough to speak: no markup, no runaway
 *  length, ends like a sentence. Empty when there is nothing to say. */
export function speechText(text, max = 280) {
	let s = String(text ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/[*_`#>|~]+/g, ' ')
		.replace(/https?:\/\/\S+/g, 'a link')
		.replace(/\s+/g, ' ')
		.replace(/\s+([.,!?;:])/g, '$1')
		.trim();
	if (!s) return '';
	if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
	if (!/[.!?…]$/.test(s)) s += '.';
	return s[0].toUpperCase() + s.slice(1);
}

export const CLIP_NAME = /^([a-f0-9]{32})\.mp3$/;

/** What the wall says when an alert or timer comes due. */
export function speechForDue(task) {
	const title = String(task?.title || '').trim();
	if (!title) return '';
	// timers are titled "Timer" or "Timer: Pasta" (src/lib/quickSay.js)
	const timer = /^timer\b:?\s*(.*)$/i.exec(title);
	if (timer) return speechText(timer[1] ? `${timer[1]} timer is done` : 'Your timer is done');
	return speechText(`Reminder: ${title}`);
}

/** Settings from the stored file, with bad values dropped. */
export function normalizeVoiceSettings(raw = {}) {
	const out = { ...DEFAULT_VOICE };
	if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
	if (typeof raw.voiceId === 'string' && /^[A-Za-z0-9]{8,40}$/.test(raw.voiceId)) out.voiceId = raw.voiceId;
	if (typeof raw.model === 'string' && /^eleven_[a-z0-9_]+$/.test(raw.model)) out.model = raw.model;
	if (HHMM.test(String(raw.quietStart ?? ''))) out.quietStart = raw.quietStart;
	if (HHMM.test(String(raw.quietEnd ?? ''))) out.quietEnd = raw.quietEnd;
	for (const key of ['dayVolume', 'nightVolume']) {
		const v = Number(raw[key]);
		// 0 to 1; a percent (22) is read as 0.22
		if (Number.isFinite(v) && v >= 0 && v <= 100) out[key] = Math.round((v > 1 ? v / 100 : v) * 100) / 100;
	}
	if (typeof raw.nightSilent === 'boolean') out.nightSilent = raw.nightSilent;
	if (typeof raw.followRoom === 'boolean') out.followRoom = raw.followRoom;
	if (typeof raw.holdWhenAway === 'boolean') out.holdWhenAway = raw.holdWhenAway;
	const chars = Number(raw.dailyChars);
	if (Number.isFinite(chars) && chars >= 0 && chars <= 100000) out.dailyChars = Math.round(chars);
	return out;
}

/**
 * The voice's volume for where you are (the camera's numbers, src/lib/senses.js
 * presenceFrom): about three quarters at arm's length, a quarter louder from
 * across the room (3.5 m and more), and softer again when you're lying down
 * at night. Without a camera, or with nobody seen, it's the plain volume.
 */
export function roomVolume(base, room, { quiet = false } = {}) {
	let v = Number(base) || 0;
	if (room?.camera && room.count) {
		const d = Number(room.distance);
		if (room.distance != null && Number.isFinite(d)) v *= 0.75 + 0.5 * Math.max(0, Math.min(1, (d - 1) / 2.5));
		if (quiet && room.posture === 'lying') v *= 0.6;
	}
	return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}

/** Nobody in the room, as far as a working camera can tell. */
export function roomEmpty(room) {
	return Boolean(room?.camera && !room.count);
}

/** What was held while you were out, said in one go when you're back. */
export function welcomeBackText(held) {
	const items = held.map((h) => speechText(h.text)).filter(Boolean);
	if (!items.length) return '';
	const shown = items.slice(-3);
	const more = items.length - shown.length;
	return `While you were out: ${shown.join(' ')}${more ? ` And ${more} more on the wall.` : ''}`;
}
