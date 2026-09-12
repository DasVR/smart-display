import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	isExtremeAlert,
	islandWeatherSlip,
	splitNwsAlerts,
	tickerText
} from './nwsAlerts.js';

describe('nws alert routing', () => {
	it('sends tornado and hurricane products to the ticker', () => {
		assert.equal(isExtremeAlert({ event: 'Tornado Warning', severity: 'Severe' }), true);
		assert.equal(isExtremeAlert({ event: 'Tornado Watch', headline: 'NWS Tampa' }), true);
		assert.equal(isExtremeAlert({ event: 'Hurricane Warning' }), true);
		assert.equal(isExtremeAlert({ event: 'Tropical Storm Watch' }), true);
		assert.equal(isExtremeAlert({ event: 'Storm Surge Warning' }), true);
		assert.equal(isExtremeAlert({ event: 'High Wind Warning', severity: 'Extreme' }), true);
	});

	it('keeps thunderstorm warnings and advisories on the island', () => {
		assert.equal(isExtremeAlert({ event: 'Severe Thunderstorm Warning', severity: 'Severe' }), false);
		assert.equal(isExtremeAlert({ event: 'Flood Watch' }), false);
		const nws = islandWeatherSlip({
			alerts: [{ event: 'Severe Thunderstorm Warning', headline: 'Until 5 PM EDT' }],
			prediction: { rain60min: 0 }
		});
		assert.equal(nws.active, true);
		assert.equal(nws.title, 'Severe Thunderstorm Warning');
	});

	it('splits a mixed NWS bundle', () => {
		const { extreme, island } = splitNwsAlerts([
			{ event: 'Tornado Warning' },
			{ event: 'Heat Advisory' },
			{ event: 'Hurricane Watch' }
		]);
		assert.deepEqual(
			extreme.map((a) => a.event),
			['Tornado Warning', 'Hurricane Watch']
		);
		assert.deepEqual(
			island.map((a) => a.event),
			['Heat Advisory']
		);
	});

	it('rolls event plus headline into ticker copy', () => {
		assert.equal(
			tickerText([
				{ event: 'Tornado Warning', headline: 'Tornado Warning for Pinellas until 7 PM' },
				{ event: 'Hurricane Watch', headline: 'Coastal Hillsborough' }
			]),
			'Tornado Warning for Pinellas until 7 PM   ·   Hurricane Watch: Coastal Hillsborough'
		);
	});

	it('builds an island slip for rain, not for extreme-only NWS', () => {
		const rain = islandWeatherSlip({
			alerts: [{ event: 'Tornado Warning' }],
			prediction: { approaching: true, etaMin: 12, rain60min: 0.7, source: 'nowcast+forecast' },
			current: { windSpeed: 14, windDirection: 80 }
		});
		assert.equal(rain.active, true);
		assert.equal(rain.kicker, 'Radar');
		assert.equal(rain.title, 'Rain in 12 min');
		assert.match(rain.extra, /14 mph/);

		const nws = islandWeatherSlip({
			alerts: [{ event: 'Heat Advisory', headline: 'Until 7 PM EDT' }],
			prediction: { rain60min: 0 }
		});
		assert.equal(nws.active, true);
		assert.equal(nws.kicker, 'Weather');
		assert.equal(nws.title, 'Heat Advisory');

		const quiet = islandWeatherSlip({
			alerts: [{ event: 'Tornado Warning' }],
			prediction: { rain60min: 0.1 }
		});
		assert.equal(quiet.active, false);
	});
});
