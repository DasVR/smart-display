/**
 * Surface profiles: each screen says what it is when it connects.
 *
 * Today that's the wall (1920×1080, read from across the room, no touch)
 * and the phone. Every client sends its profile in `hello`, the server
 * keeps it per connection, and GET /api/surfaces lists who's connected.
 * The wall also turns its profile into one motion level for its CSS
 * (`<html data-motion>`): full, or lite when the glass is flat, the
 * frame governor has throttled, or the person asked for reduced motion.
 *
 * Only a flag for now. A second screen would read the same room state and
 * render what its profile allows, without a fork of the wall.
 *
 * Pure: tests/surface.test.mjs.
 */

export const SURFACE_KINDS = ['wall', 'phone', 'tablet'];

/**
 * Describe this screen. `glass` is the wall's effective glass tier
 * (refract | flat | frozen), when it has one.
 */
export function surfaceProfile({ role = 'wall', width = 0, height = 0, touch = false, reducedMotion = false, glass = 'refract' } = {}) {
	const w = Math.round(Number(width) || 0);
	const h = Math.round(Number(height) || 0);
	const kind = role === 'remote' ? (Math.min(w, h) >= 700 ? 'tablet' : 'phone') : 'wall';
	const gpu = glass === 'frozen' ? 'none' : glass === 'flat' ? 'lite' : 'full';
	return {
		kind,
		size: [w, h],
		distance: kind === 'wall' ? 'room' : 'hand',
		input: touch ? 'touch' : 'none',
		gpu,
		motion: reducedMotion || gpu !== 'full' ? 'lite' : 'full'
	};
}

/** What the server keeps from a client's claim: known values only. */
export function normalizeSurface(input) {
	if (!input || typeof input !== 'object') return null;
	const kind = SURFACE_KINDS.includes(input.kind) ? input.kind : null;
	if (!kind) return null;
	const size = Array.isArray(input.size) ? input.size.slice(0, 2).map((n) => Math.max(0, Math.min(16384, Math.round(Number(n) || 0)))) : [0, 0];
	const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
	return {
		kind,
		size: size.length === 2 ? size : [0, 0],
		distance: pick(input.distance, ['room', 'hand'], kind === 'wall' ? 'room' : 'hand'),
		input: pick(input.input, ['touch', 'none'], 'none'),
		gpu: pick(input.gpu, ['full', 'lite', 'none'], 'full'),
		motion: pick(input.motion, ['full', 'lite'], 'full')
	};
}
