import { execSync } from 'node:child_process';

/** Parse `wpctl get-volume @DEFAULT_AUDIO_SINK@` output, e.g.
 *  "Volume: 0.65" or "Volume: 0.65 [MUTED]". Returns null if unparsable. */
export function parseWpctlVolume(text = '') {
	const m = String(text).match(/Volume:\s*([\d.]+)/);
	if (!m) return null;
	return {
		volume: clampVolume(parseFloat(m[1])),
		muted: /\[MUTED\]/i.test(text)
	};
}

/** wpctl accepts over-amplified volume up to 1.5 (150%); keep the same
 *  ceiling here so callers can't request something wpctl would reject. */
export function clampVolume(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.min(1.5, Math.max(0, n));
}

function run(cmd, opts = {}) {
	return execSync(cmd, { encoding: 'utf8', timeout: opts.timeout ?? 3000 });
}

/** Reads the default sink's current volume/mute state via wpctl. */
export function getVolume() {
	try {
		const out = run('wpctl get-volume @DEFAULT_AUDIO_SINK@');
		const parsed = parseWpctlVolume(out);
		if (!parsed) return { ok: false, error: 'could not parse wpctl output' };
		return { ok: true, ...parsed };
	} catch (e) {
		return { ok: false, error: e.message || 'wpctl get-volume failed' };
	}
}

/** Sets the default sink's volume (0..1.5) via wpctl. */
export function setVolume(volume) {
	const v = clampVolume(volume);
	try {
		run(`wpctl set-volume @DEFAULT_AUDIO_SINK@ ${v.toFixed(2)}`);
		return getVolume();
	} catch (e) {
		return { ok: false, error: e.message || 'wpctl set-volume failed' };
	}
}

/** Sets or toggles mute on the default sink via wpctl. */
export function setMute(muted) {
	try {
		run(`wpctl set-mute @DEFAULT_AUDIO_SINK@ ${muted ? '1' : '0'}`);
		return getVolume();
	} catch (e) {
		return { ok: false, error: e.message || 'wpctl set-mute failed' };
	}
}
