import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSurface, surfaceProfile } from '../src/lib/surface.js';

test('the wall, a phone and a tablet describe themselves', () => {
	assert.deepEqual(surfaceProfile({ role: 'wall', width: 1920, height: 1080 }), {
		kind: 'wall',
		size: [1920, 1080],
		distance: 'room',
		input: 'none',
		gpu: 'full',
		motion: 'full'
	});
	const phone = surfaceProfile({ role: 'remote', width: 390, height: 844, touch: true });
	assert.equal(phone.kind, 'phone');
	assert.equal(phone.distance, 'hand');
	assert.equal(phone.input, 'touch');
	assert.equal(surfaceProfile({ role: 'remote', width: 820, height: 1180 }).kind, 'tablet');
});

test('motion is lite when the glass is flat or frozen, or motion is reduced', () => {
	assert.equal(surfaceProfile({ glass: 'flat' }).motion, 'lite');
	assert.equal(surfaceProfile({ glass: 'flat' }).gpu, 'lite');
	assert.equal(surfaceProfile({ glass: 'frozen' }).gpu, 'none');
	assert.equal(surfaceProfile({ reducedMotion: true }).motion, 'lite');
	assert.equal(surfaceProfile({ glass: 'refract' }).motion, 'full');
});

test('the server keeps only known values', () => {
	assert.equal(normalizeSurface(null), null);
	assert.equal(normalizeSurface({ kind: 'toaster' }), null);
	assert.deepEqual(normalizeSurface({ kind: 'phone', size: [390.4, 99999, 3], gpu: 'quantum', input: 'touch', evil: true }), {
		kind: 'phone',
		size: [390, 16384],
		distance: 'hand',
		input: 'touch',
		gpu: 'full',
		motion: 'full'
	});
});
