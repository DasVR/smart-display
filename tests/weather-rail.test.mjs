import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyWeatherRail, RAIN_RAIL_SCORE } from '../src/lib/weatherRail.js';

test('Extreme tornado warning becomes a warning rail', () => {
	const rail = classifyWeatherRail({
		alerts: [
			{
				event: 'Tornado Warning',
				severity: 'Extreme',
				headline: 'Tornado Warning for Pinellas including Largo until 4:15 PM EDT'
			}
		],
		prediction: { rain30min: 0.9, rain60min: 0.9, rain120min: 0.4 }
	});
	assert.equal(rail.kind, 'warning');
	assert.equal(rail.title, 'Tornado Warning');
	assert.match(rail.body, /Pinellas/);
});

test('event name Warning wins even when NWS severity is Moderate', () => {
	const rail = classifyWeatherRail({
		alerts: [{ event: 'Severe Thunderstorm Warning', severity: 'Moderate', headline: '' }]
	});
	assert.equal(rail.kind, 'warning');
	assert.equal(rail.title, 'Severe Thunderstorm Warning');
});

test('Tornado Watch stays a watch even when NWS marks it Severe', () => {
	const rail = classifyWeatherRail({
		alerts: [{ event: 'Tornado Watch', severity: 'Severe', headline: 'Watch until 8 PM' }]
	});
	assert.equal(rail.kind, 'watch');
	assert.equal(rail.title, 'Tornado Watch');
});

test('Moderate flood watch is a watch rail', () => {
	const rail = classifyWeatherRail({
		alerts: [{ event: 'Flood Watch', severity: 'Moderate', headline: 'Flooding possible' }]
	});
	assert.equal(rail.kind, 'watch');
	assert.equal(rail.kicker, 'Weather watch');
});

test('Flood Advisory is a watch rail', () => {
	const rail = classifyWeatherRail({
		alerts: [{ event: 'Flood Advisory', severity: 'Minor', headline: '' }]
	});
	assert.equal(rail.kind, 'watch');
	assert.equal(rail.kicker, 'Weather watch');
});

test('unnamed minor NWS alert still raises a notice rail', () => {
	const rail = classifyWeatherRail({
		alerts: [{ event: 'Special Weather Statement', severity: 'Minor', headline: 'Gusty winds' }]
	});
	assert.equal(rail.kind, 'watch');
	assert.equal(rail.kicker, 'Weather notice');
	assert.equal(rail.title, 'Special Weather Statement');
});

test('warning outranks a simultaneous watch', () => {
	const rail = classifyWeatherRail({
		alerts: [
			{ event: 'Flood Watch', severity: 'Moderate', headline: '' },
			{ event: 'Tornado Warning', severity: 'Extreme', headline: 'Take cover' }
		]
	});
	assert.equal(rail.kind, 'warning');
	assert.equal(rail.title, 'Tornado Warning');
});

test('rain in 30 minutes raises a rain rail at the score floor', () => {
	const rail = classifyWeatherRail({
		alerts: [],
		prediction: { rain30min: RAIN_RAIL_SCORE, rain60min: 0.4, rain120min: 0.2 }
	});
	assert.equal(rail.kind, 'rain');
	assert.equal(rail.title, 'Rain in 30 minutes');
});

test('rain in an hour when the 30-minute score is still low', () => {
	const rail = classifyWeatherRail({
		prediction: { rain30min: 0.2, rain60min: 0.61, rain120min: 0.8 }
	});
	assert.equal(rail.kind, 'rain');
	assert.equal(rail.title, 'Rain in an hour');
});

test('two-hour rain uses a higher floor so it does not nag all afternoon', () => {
	assert.equal(
		classifyWeatherRail({ prediction: { rain30min: 0.1, rain60min: 0.2, rain120min: 0.6 } }),
		null
	);
	const rail = classifyWeatherRail({
		prediction: { rain30min: 0.1, rain60min: 0.2, rain120min: 0.7 }
	});
	assert.equal(rail.kind, 'rain');
	assert.equal(rail.title, 'Rain in 2 hours');
});

test('radar nowcast eta becomes a rain rail', () => {
	const arriving = classifyWeatherRail({
		prediction: { rain30min: 0.2, rain60min: 0.22, rain120min: 0.2, approaching: true, etaMin: 4 }
	});
	assert.equal(arriving.kind, 'rain');
	assert.equal(arriving.title, 'Rain arriving');

	const soon = classifyWeatherRail({
		prediction: { rain30min: 0.2, rain60min: 0.25, rain120min: 0.3, approaching: true, etaMin: 18 }
	});
	assert.equal(soon.kind, 'rain');
	assert.equal(soon.title, 'Rain in 18 minutes');
});

test('below-threshold rain and empty alerts hide the rail', () => {
	assert.equal(classifyWeatherRail(null), null);
	assert.equal(classifyWeatherRail({}), null);
	assert.equal(
		classifyWeatherRail({
			alerts: [],
			prediction: { rain30min: 0.4, rain60min: 0.5, rain120min: 0.5 }
		}),
		null
	);
});
