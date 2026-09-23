/**
 * Smart Stack: picks the view the room most likely wants, the way iOS
 * rotates a Smart Stack widget. Pure so it can be unit-tested; the page
 * feeds it state once a second and applies whatever it returns.
 *
 * Rules, in priority order:
 *  1. Never move while someone is interacting (touch, key, remote) within
 *     HANDS_OFF_MS.
 *  2. Playback starts while on Clock → Music. Remember we moved it.
 *  3. Playback stops on a Music view we moved to → back where it came from.
 *  4. Idle for IDLE_RETURN_MS on any view except Clock (and not Music while
 *     playing) → Clock.
 */

export const HANDS_OFF_MS = 30_000;
export const IDLE_RETURN_MS = 10 * 60_000;
export const STANDBY_IDLE_MS = 2 * 60_000;

/**
 * @param {object} s
 * @param {string} s.view          current view
 * @param {number} s.now           ms
 * @param {number} s.lastInput     ms of the last human interaction
 * @param {boolean} s.playing      music playing now
 * @param {boolean} s.wasPlaying   music playing on the previous tick
 * @param {string|null} s.autoFrom view we auto-left, or null
 * @returns {{ view: string, autoFrom: string|null, reason: string } | null}
 */
export function decideSmartStack({ view, now, lastInput, playing, wasPlaying, autoFrom = null }) {
	const idle = now - (lastInput || 0);
	if (idle < HANDS_OFF_MS) return null;

	if (playing && !wasPlaying && view === 'clock') {
		return { view: 'music', autoFrom: 'clock', reason: 'playback-started' };
	}
	if (!playing && wasPlaying && view === 'music' && autoFrom) {
		return { view: autoFrom, autoFrom: null, reason: 'playback-stopped' };
	}
	if (idle >= IDLE_RETURN_MS && view !== 'clock' && !(view === 'music' && playing)) {
		return { view: 'clock', autoFrom: null, reason: 'idle-return' };
	}
	return null;
}

/** StandBy night: an idle clock after dark dims and shifts red. */
export function isStandBy({ view, phase, now, lastInput, mode = 'normal' }) {
	if (mode !== 'normal' || view !== 'clock' || phase !== 'night') return false;
	return now - (lastInput || 0) >= STANDBY_IDLE_MS;
}
