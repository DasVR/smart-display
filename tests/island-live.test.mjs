import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ordinalSuffix, shortDateline } from '../src/lib/dateline.js';
import { compactSlots } from '../src/lib/islandLive.js';

const activity = (title, overrides = {}) => ({
	id: `act:${title}`,
	kind: 'test',
	title,
	body: 'Down',
	severity: 'error',
	...overrides
});

describe('dateline', () => {
	it('writes September 12th without the weekday', () => {
		assert.equal(ordinalSuffix(12), 'th');
		assert.equal(ordinalSuffix(1), 'st');
		assert.equal(ordinalSuffix(2), 'nd');
		assert.equal(ordinalSuffix(3), 'rd');
		assert.equal(ordinalSuffix(11), 'th');
		assert.equal(ordinalSuffix(22), 'nd');
		assert.equal(shortDateline('September', 12), 'September 12th');
	});
});

describe('compact slots', () => {
	it('idles when nothing is ongoing', () => {
		assert.equal(compactSlots(null, []), null);
		assert.equal(compactSlots({ playing: false }, []), null);
	});

	it('keeps music compact with an equalizer trailing side', () => {
		const slots = compactSlots({ playing: true, title: 'Night Drive', artist: 'Demo FM' }, []);
		assert.equal(slots.leading.kind, 'music');
		assert.equal(slots.leading.title, 'Night Drive');
		assert.equal(slots.trailing.kind, 'eq');
	});

	it('keeps a single ongoing activity up as a compact Live Activity', () => {
		const slots = compactSlots(null, [activity('hermes')]);
		assert.equal(slots.leading.title, 'hermes');
		assert.equal(slots.trailing.kind, 'status');
		assert.equal(slots.trailing.title, 'Down');
	});

	it('puts music on the leading side and an activity on the trailing side', () => {
		const slots = compactSlots({ playing: true, title: 'Night Drive' }, [activity('hermes')]);
		assert.equal(slots.leading.kind, 'music');
		assert.equal(slots.trailing.kind, 'test');
		assert.equal(slots.trailing.title, 'hermes');
	});

	it('stacks extra ongoing activities on the trailing side', () => {
		const slots = compactSlots(null, [activity('hermes'), activity('godmode'), activity('leadvine')]);
		assert.equal(slots.leading.title, 'hermes');
		assert.equal(slots.trailing.kind, 'stack');
		assert.equal(slots.trailing.title, '2 down');
	});
});
