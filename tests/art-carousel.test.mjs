import { test } from 'node:test';
import assert from 'node:assert/strict';

import { advanceArtRing, artCarouselSlots, resetArtCarousel, rememberNowPlaying } from '../src/lib/artCarousel.js';

test('advanceArtRing peeks previous and next from session history', () => {
	let state = { ring: [], index: -1 };
	state = advanceArtRing(state.ring, state.index, { artist: 'A', title: 'One', art: '1' });
	state = advanceArtRing(state.ring, state.index, { artist: 'B', title: 'Two', art: '2' });
	state = advanceArtRing(state.ring, state.index, { artist: 'C', title: 'Three', art: '3' });
	let slots = artCarouselSlots(state.ring, state.index);
	assert.equal(slots.prev.title, 'Two');
	assert.equal(slots.current.title, 'Three');
	assert.equal(slots.next, null);

	state = advanceArtRing(state.ring, state.index, { artist: 'B', title: 'Two', art: '2' });
	slots = artCarouselSlots(state.ring, state.index);
	assert.equal(slots.prev.title, 'One');
	assert.equal(slots.current.title, 'Two');
	assert.equal(slots.next.title, 'Three');
});

test('advanceArtRing truncates future when a new title starts mid-history', () => {
	let state = { ring: [], index: -1 };
	state = advanceArtRing(state.ring, state.index, { artist: 'A', title: 'One', art: '1' });
	state = advanceArtRing(state.ring, state.index, { artist: 'B', title: 'Two', art: '2' });
	state = advanceArtRing(state.ring, state.index, { artist: 'A', title: 'One', art: '1' });
	state = advanceArtRing(state.ring, state.index, { artist: 'D', title: 'Four', art: '4' });
	const slots = artCarouselSlots(state.ring, state.index);
	assert.equal(slots.prev.title, 'One');
	assert.equal(slots.current.title, 'Four');
	assert.equal(slots.next, null);
});

test('rememberNowPlaying keeps a module session that skip-back can restore', () => {
	resetArtCarousel();
	rememberNowPlaying({ artist: 'A', title: 'One', art: '1' });
	rememberNowPlaying({ artist: 'B', title: 'Two', art: '2' });
	const back = rememberNowPlaying({ artist: 'A', title: 'One', art: '1b' });
	assert.equal(back.current.art, '1b');
	assert.equal(back.next.title, 'Two');
	resetArtCarousel();
});
