import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isExtremeAlert, splitNwsAlerts, tickerText } from '../src/lib/nwsAlerts.js';

describe('extreme alert classification', () => {
	it('flags tornado and hurricane products regardless of severity field', () => {
		assert.equal(isExtremeAlert({ event: 'Tornado Warning', severity: 'Severe' }), true);
		assert.equal(isExtremeAlert({ event: 'Hurricane Warning', severity: 'Moderate' }), true);
	});

	it('flags anything the feed itself marks Extreme', () => {
		assert.equal(isExtremeAlert({ event: 'Flash Flood Warning', severity: 'Extreme' }), true);
	});

	it('leaves ordinary watches/advisories off the extreme path', () => {
		assert.equal(isExtremeAlert({ event: 'Heat Advisory', severity: 'Moderate' }), false);
		assert.equal(isExtremeAlert({ event: 'Wind Advisory', severity: 'Minor' }), false);
	});

	it('splits a mixed alert list into extreme vs. island-worthy', () => {
		const { extreme, island } = splitNwsAlerts([
			{ event: 'Tornado Warning', severity: 'Extreme' },
			{ event: 'Heat Advisory', severity: 'Moderate' }
		]);
		assert.equal(extreme.length, 1);
		assert.equal(extreme[0].event, 'Tornado Warning');
		assert.equal(island.length, 1);
		assert.equal(island[0].event, 'Heat Advisory');
	});
});

describe('ticker text', () => {
	it('renders nothing for an empty alert list', () => {
		assert.equal(tickerText([]), '');
	});

	it('joins event and headline when the headline does not already lead with it', () => {
		const text = tickerText([{ event: 'Tornado Warning', headline: 'until 4:15 PM EDT' }]);
		assert.equal(text, 'Tornado Warning: until 4:15 PM EDT');
	});
});
