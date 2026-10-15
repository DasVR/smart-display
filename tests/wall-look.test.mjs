import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTWORKS, DEFAULT_LOOK, artFor, normalizeLook } from '../src/lib/look/wallLook.js';
import { lateBy, taskWhen, todayOpen } from '../src/lib/todayList.js';

test('look: halftone by default; unknown values keep what was there', () => {
	assert.deepEqual(normalizeLook({}), DEFAULT_LOOK);
	assert.deepEqual(normalizeLook({ look: 'classic', art: 'magpie' }), { look: 'classic', art: 'magpie' });
	assert.deepEqual(normalizeLook({ look: 'neon', art: 'mona-lisa' }, { look: 'classic', art: 'starry' }), { look: 'classic', art: 'starry' });
	assert.deepEqual(normalizeLook(null), DEFAULT_LOOK);
});

test('look: the painting follows the hour unless one is chosen', () => {
	assert.deepEqual([6, 12, 17, 22, 2].map((h) => artFor('auto', h)), ['almond', 'poppies', 'magpie', 'starry', 'starry']);
	assert.equal(artFor('magpie', 2), 'magpie');
	for (const key of Object.keys(ARTWORKS)) assert.ok(ARTWORKS[key].title && ARTWORKS[key].artist);
});

test('today list: late items say how late, others their time', () => {
	const now = Date.parse('2026-10-15T13:00:00Z'); // 9:00 am on the wall
	const late = { status: 'overdue', nextDue: '2026-10-15T12:00:00Z' };
	const later = { status: 'today', nextDue: '2026-10-15T23:59:00Z' };
	assert.equal(lateBy(late.nextDue, now), '1 h late');
	assert.equal(lateBy('2026-10-15T12:35:00Z', now), '25 min late');
	assert.equal(taskWhen({ ...late, nextDue: '2026-10-15T11:00:00Z' }, now), '2 h late');
	assert.equal(taskWhen(later, now), '7:59 pm');
	assert.deepEqual(todayOpen([late, later, { status: 'upcoming' }], now), [late, later]);
});
