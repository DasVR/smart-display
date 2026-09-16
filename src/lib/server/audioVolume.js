import { execFileSync } from 'node:child_process';

import { parseWpctlStatus, pickSpeakerSink } from './audioSinks.js';
import { userSessionEnv } from './kioskStatus.js';

const DEFAULT_TARGET = '@DEFAULT_AUDIO_SINK@';

/** Parse `wpctl get-volume` output, e.g. "Volume: 0.65" or
 *  "Volume: 0.65 [MUTED]". Returns null if unparsable. */
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

export function coerceVolume(v) {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

/** Prefer the analog/USB/headphone sink the rest of the kiosk uses, not
 *  whatever PipeWire currently marks default (often Dummy or HDMI). */
export function volumeTargetFromStatus(statusText = '') {
	const pick = pickSpeakerSink(parseWpctlStatus(statusText));
	if (!pick) {
		return { target: DEFAULT_TARGET, sinkId: null, sinkName: null };
	}
	return { target: String(pick.id), sinkId: pick.id, sinkName: pick.name };
}

export function volumeWpctlArgs(action, target, extra) {
	const t = target || DEFAULT_TARGET;
	switch (action) {
		case 'status':
			return ['status'];
		case 'get':
			return ['get-volume', t];
		case 'set':
			return ['set-volume', t, extra];
		case 'mute':
			return ['set-mute', t, extra];
		default:
			throw new Error(`unknown wpctl volume action: ${action}`);
	}
}

function wpctlError(error, fallback) {
	const stderr = String(error?.stderr || '').trim();
	const msg = String(error?.message || '').trim();
	return stderr || msg || fallback;
}

function defaultExec(args, env) {
	return execFileSync('wpctl', args, {
		encoding: 'utf8',
		timeout: 3000,
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

// The sink almost never changes between one volume tap and the next, so
// resolving it fresh via `wpctl status` on every single get/set (on top of
// the get/set-volume call itself) was turning each remote volume tap into
// 2-5 sequential wpctl spawns - the latency the phone remote was showing.
// Cache the resolved target briefly and only force a fresh resolve when a
// write actually fails (the sink may really have changed).
const TARGET_TTL_MS = 5000;
const GLOBAL_TARGET_CACHE = { at: 0, resolved: null };

export function withVolumeIo({ env, execWpctl, now, state } = {}) {
	const session = env || userSessionEnv();
	const run = execWpctl || defaultExec;
	const cache = state || GLOBAL_TARGET_CACHE;
	const clock = now || Date.now;

	function resolveTarget() {
		if (cache.resolved && clock() - cache.at < TARGET_TTL_MS) {
			return cache.resolved;
		}
		let statusText = '';
		try {
			statusText = run(volumeWpctlArgs('status'), session) || '';
		} catch {
			statusText = '';
		}
		const resolved = volumeTargetFromStatus(statusText);
		cache.resolved = resolved;
		cache.at = clock();
		return resolved;
	}

	function snapshotFor(resolved) {
		try {
			const out = run(volumeWpctlArgs('get', resolved.target), session);
			const parsed = parseWpctlVolume(out);
			if (!parsed) return { ok: false, error: 'could not parse wpctl output' };
			return {
				ok: true,
				...parsed,
				sinkId: resolved.sinkId,
				sinkName: resolved.sinkName
			};
		} catch (e) {
			return { ok: false, error: wpctlError(e, 'wpctl get-volume failed') };
		}
	}

	function snapshot() {
		return snapshotFor(resolveTarget());
	}

	function setVolume(volume) {
		const v = clampVolume(volume);
		const resolved = resolveTarget();
		try {
			run(volumeWpctlArgs('set', resolved.target, v.toFixed(2)), session);
			if (v > 0) {
				try {
					run(volumeWpctlArgs('mute', resolved.target, '0'), session);
				} catch {
					/* keep the volume write even if unmute fails */
				}
			}
			return snapshotFor(resolved);
		} catch (e) {
			cache.resolved = null;
			return { ok: false, error: wpctlError(e, 'wpctl set-volume failed') };
		}
	}

	function setMute(muted) {
		const resolved = resolveTarget();
		try {
			run(volumeWpctlArgs('mute', resolved.target, muted ? '1' : '0'), session);
			return snapshotFor(resolved);
		} catch (e) {
			cache.resolved = null;
			return { ok: false, error: wpctlError(e, 'wpctl set-mute failed') };
		}
	}

	return { getVolume: snapshot, setVolume, setMute };
}

/** Reads the speaker sink's current volume/mute state via wpctl. */
export function getVolume(opts) {
	return withVolumeIo(opts).getVolume();
}

/** Sets the speaker sink's volume (0..1.5) via wpctl. */
export function setVolume(volume, opts) {
	return withVolumeIo(opts).setVolume(volume);
}

/** Sets mute on the speaker sink via wpctl. */
export function setMute(muted, opts) {
	return withVolumeIo(opts).setMute(muted);
}

export function applyVolumePayload(data, opts) {
	const io = withVolumeIo(opts);
	if (data && typeof data.muted === 'boolean' && data.volume === undefined) {
		return io.setMute(data.muted);
	}
	const volume = coerceVolume(data?.volume);
	if (volume !== null) {
		return io.setVolume(volume);
	}
	if (typeof data?.muted === 'boolean') {
		return io.setMute(data.muted);
	}
	return { ok: false, error: 'expected { volume } or { muted }' };
}

export function volumeHttpStatus(result) {
	if (result?.ok) return 200;
	if (result?.error === 'expected { volume } or { muted }') return 400;
	return 503;
}
