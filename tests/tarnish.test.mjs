import test from 'node:test';
import assert from 'node:assert/strict';
import { tarnishLevel } from '../src/lib/tarnish.js';

const NOW = Date.UTC(2026, 9, 9, 18);
const chore = (hoursAgo, extra = {}) => ({
	kind: 'chore',
	active: true,
	nextDue: new Date(NOW - hoursAgo * 3600000).toISOString(),
	...extra
});

test('only overdue chores tarnish, more the longer they wait', () => {
	assert.equal(tarnishLevel([], NOW), 0);
	assert.equal(tarnishLevel(null, NOW), 0);
	assert.equal(tarnishLevel([chore(-1)], NOW), 0, 'not due yet');
	assert.equal(tarnishLevel([chore(1, { kind: 'alert' })], NOW), 0, 'alerts move on by themselves');
	assert.equal(tarnishLevel([chore(1, { snoozedUntil: new Date(NOW + 60000).toISOString() })], NOW), 0, 'snoozed');
	assert.equal(tarnishLevel([chore(1, { active: false })], NOW), 0, 'done');

	const fresh = tarnishLevel([chore(0.01)], NOW);
	const stale = tarnishLevel([chore(12)], NOW);
	assert.ok(fresh > 0.13 && fresh < 0.15, `fresh ${fresh}`);
	assert.equal(stale, 0.3);
	assert.ok(tarnishLevel([chore(1), chore(2)], NOW) > fresh);
	assert.equal(tarnishLevel([chore(48), chore(48), chore(48), chore(48)], NOW), 0.75, 'capped');
});
