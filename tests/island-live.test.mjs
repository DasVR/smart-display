import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ordinalSuffix, shortDateline } from '../src/lib/dateline.js';
import {
	applyServiceSnapshot,
	compactSlots,
	serviceActivity,
	serviceActivityId
} from '../src/lib/islandLive.js';

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

describe('service snapshot', () => {
	const up = (name) => ({ name, status: true });
	const down = (name) => ({ name, status: false });

	it('seeds already-down services on first poll without chiming', () => {
		const snap = applyServiceSnapshot(null, [up('display'), down('hermes')]);
		assert.equal(snap.seed, true);
		assert.deepEqual(snap.events, []);
		assert.deepEqual(snap.set, [serviceActivity('hermes')]);
		assert.deepEqual(snap.clear, []);
	});

	it('pings the island when a live service drops, and keeps a compact activity', () => {
		const snap = applyServiceSnapshot([up('hermes')], [down('hermes')]);
		assert.equal(snap.events[0].title, 'Service down');
		assert.equal(snap.events[0].body, 'hermes');
		assert.equal(snap.events[0].severity, 'error');
		assert.deepEqual(snap.set, [serviceActivity('hermes')]);
	});

	it('pings recovered and clears the compact activity', () => {
		const snap = applyServiceSnapshot([down('hermes')], [up('hermes')]);
		assert.equal(snap.events[0].title, 'Service recovered');
		assert.equal(snap.events[0].severity, 'ok');
		assert.deepEqual(snap.clear, [serviceActivityId('hermes')]);
		assert.deepEqual(snap.set, []);
	});

	it('does not re-emit while a service stays down', () => {
		const snap = applyServiceSnapshot([down('hermes')], [down('hermes')]);
		assert.deepEqual(snap.events, []);
		assert.deepEqual(snap.set, []);
		assert.deepEqual(snap.clear, []);
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

	it('keeps a downed service up as a compact Live Activity', () => {
		const slots = compactSlots(null, [serviceActivity('hermes')]);
		assert.equal(slots.leading.title, 'hermes');
		assert.equal(slots.trailing.kind, 'status');
		assert.equal(slots.trailing.title, 'Down');
	});

	it('puts music on the leading side and a service on the trailing side', () => {
		const slots = compactSlots(
			{ playing: true, title: 'Night Drive' },
			[serviceActivity('hermes')]
		);
		assert.equal(slots.leading.kind, 'music');
		assert.equal(slots.trailing.kind, 'service');
		assert.equal(slots.trailing.title, 'hermes');
	});
});
