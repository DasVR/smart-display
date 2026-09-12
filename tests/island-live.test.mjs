import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ordinalSuffix, shortDateline } from '../src/lib/dateline.js';
import {
	applyServiceSnapshot,
	dockChips,
	recoveredActivity,
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

	it('records a downed service as a dock chip, not an island ping', () => {
		const snap = applyServiceSnapshot([up('hermes')], [down('hermes')]);
		assert.equal(snap.events[0].title, 'Service down');
		assert.equal(snap.events[0].body, 'hermes');
		assert.equal(snap.events[0].severity, 'error');
		assert.deepEqual(snap.set, [serviceActivity('hermes')]);
		assert.ok(snap.clear.includes(recoveredActivity('hermes').id));
	});

	it('flashes recovered on the dock and clears the down chip', () => {
		const snap = applyServiceSnapshot([down('hermes')], [up('hermes')]);
		assert.equal(snap.events[0].title, 'Service recovered');
		assert.equal(snap.events[0].severity, 'ok');
		assert.ok(snap.clear.includes(serviceActivityId('hermes')));
		assert.deepEqual(snap.set, [recoveredActivity('hermes')]);
		assert.equal(snap.set[0].ttl, 5000);
	});

	it('does not re-emit while a service stays down', () => {
		const snap = applyServiceSnapshot([down('hermes')], [down('hermes')]);
		assert.deepEqual(snap.events, []);
		assert.deepEqual(snap.set, []);
		assert.deepEqual(snap.clear, []);
	});
});

describe('dock chips', () => {
	it('idles when nothing is ongoing', () => {
		assert.deepEqual(dockChips([]), []);
		assert.deepEqual(dockChips(null), []);
	});

	it('keeps a downed service on the trough', () => {
		const chips = dockChips([serviceActivity('hermes')]);
		assert.equal(chips.length, 1);
		assert.equal(chips[0].title, 'hermes');
		assert.equal(chips[0].body, 'Down');
	});

	it('collapses extra chips into N more', () => {
		const chips = dockChips(
			[
				serviceActivity('hermes'),
				serviceActivity('godmode'),
				serviceActivity('leadvine'),
				serviceActivity('dasdev.net'),
				serviceActivity('display')
			],
			{ max: 4 }
		);
		assert.equal(chips.length, 4);
		assert.equal(chips[3].kind, 'stack');
		assert.equal(chips[3].title, '2 more');
	});
});
