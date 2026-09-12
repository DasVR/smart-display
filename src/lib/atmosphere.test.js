import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	compassFromDeg,
	fallbackPhase,
	fmtSunTime,
	phaseKicker,
	sunAmount,
	sunPhase,
	twilightAmount,
	windTowardDeg
} from './atmosphere.js';
import {
	alertKeyForPrediction,
	fuseRainPrediction,
	mergeRadarPrediction,
	rainIntensityFromRgba,
	samplePatchIntensity
} from './rainModel.js';
import {
	LARGO_LAT,
	LARGO_LON,
	TILE_SIZE,
	homeTilePixel,
	lonLatToFractionalTile,
	tilesCoveringRadius,
	tilesCoveringRect
} from './radarMap.js';

describe('atmosphere', () => {
	it('names compass points from meteorological degrees', () => {
		assert.equal(compassFromDeg(0), 'N');
		assert.equal(compassFromDeg(90), 'E');
		assert.equal(compassFromDeg(180), 'S');
		assert.equal(compassFromDeg(270), 'W');
		assert.equal(compassFromDeg(45), 'NE');
		assert.equal(compassFromDeg(360), 'N');
		assert.equal(compassFromDeg(NaN), '--');
	});

	it('points the vane toward travel, not the from-direction', () => {
		assert.equal(windTowardDeg(0), 180);
		assert.equal(windTowardDeg(90), 270);
		assert.equal(windTowardDeg(180), 0);
	});

	it('splits night / dawn / day / dusk around sunrise and sunset', () => {
		const rise = Date.parse('2026-09-12T07:12:00-04:00');
		const set = Date.parse('2026-09-12T19:28:00-04:00');
		assert.equal(sunPhase(rise - 60 * 60 * 1000, rise, set), 'night');
		assert.equal(sunPhase(rise - 10 * 60 * 1000, rise, set), 'dawn');
		assert.equal(sunPhase(rise + 60 * 1000, rise, set), 'day');
		assert.equal(sunPhase(set + 10 * 60 * 1000, rise, set), 'dusk');
		assert.equal(sunPhase(set + 60 * 60 * 1000, rise, set), 'night');
		assert.equal(sunPhase(rise, null, null), fallbackPhase(rise));
	});

	it('keeps daytime metal at 1 and night darker', () => {
		const rise = Date.parse('2026-09-12T07:12:00-04:00');
		const set = Date.parse('2026-09-12T19:28:00-04:00');
		const noon = (rise + set) / 2;
		assert.ok(sunAmount(noon, rise, set) > 0.9);
		assert.ok(sunAmount(rise - 2 * 3600_000, rise, set) < 0.2);
		assert.ok(twilightAmount(rise, rise, set) > 0.8);
		assert.equal(twilightAmount(noon, rise, set), 0);
	});

	it('formats Open-Meteo wall clocks in New York, not UTC', () => {
		assert.equal(fmtSunTime('2026-09-11T07:14'), '7:14 AM');
		assert.equal(fmtSunTime('2026-09-11T19:40'), '7:40 PM');
	});

	it('writes clock kickers without a fake weekday on day', () => {
		assert.equal(phaseKicker('day', 'Saturday'), 'Saturday');
		assert.equal(phaseKicker('dusk', 'Saturday'), 'Dusk · Saturday');
		assert.equal(phaseKicker('night', 'Saturday'), 'After dark · Saturday');
	});
});

describe('rain model', () => {
	const now = Date.parse('2026-09-12T15:00:00-04:00');

	it('raises short-term rain when minutely precip is incoming', () => {
		const hourly = [
			{ time: '2026-09-12T15:00:00', precipitation_probability: 10, precipitation: 0 },
			{ time: '2026-09-12T16:00:00', precipitation_probability: 10, precipitation: 0 }
		];
		const minutely = [
			{ time: '2026-09-12T15:15:00', precipitation: 0.12, weather_code: 61 }
		];
		const pred = fuseRainPrediction({ hourly, minutely, nowMs: now });
		assert.ok(pred.rain30min > 0.18);
		assert.equal(pred.etaMin, 15);
		assert.equal(pred.approaching, true);
	});

	it('treats a wet nowcast after a dry past as approaching rain', () => {
		const radarSamples = [
			{ ts: now - 600_000, intensity: 0.02, nowcast: false },
			{ ts: now + 1_200_000, intensity: 0.4, nowcast: true }
		];
		const pred = fuseRainPrediction({ radarSamples, nowMs: now });
		assert.equal(pred.approaching, true);
		assert.equal(pred.source, 'nowcast+forecast');
		assert.equal(pred.etaMin, 20);
	});

	it('keeps server forecast when merging a stronger radar hit', () => {
		const merged = mergeRadarPrediction(
			{ rain30min: 0.2, rain60min: 0.25, rain120min: 0.3, source: 'forecast', etaMin: 50 },
			[{ ts: now + 600_000, intensity: 0.8, nowcast: true }],
			now
		);
		assert.ok(merged.rain30min >= 0.2);
		assert.ok(merged.etaMin <= 10);
		assert.equal(merged.source, 'nowcast+forecast');
	});

	it('reads rain from opaque colorful pixels and ignores clear tiles', () => {
		assert.equal(rainIntensityFromRgba(0, 0, 0, 0), 0);
		assert.ok(rainIntensityFromRgba(40, 200, 80, 255) > 0.5);
		const clear = new Uint8ClampedArray(4 * 4).fill(0);
		assert.equal(samplePatchIntensity(clear, 2, 2), 0);
	});

	it('buckets island alerts so a 5 min poll does not re-chime', () => {
		const a = alertKeyForPrediction({ etaMin: 12, approaching: true }, new Date(now));
		const b = alertKeyForPrediction({ etaMin: 8, approaching: true }, new Date(now));
		assert.equal(a, b);
		const c = alertKeyForPrediction({ etaMin: 40, approaching: true }, new Date(now));
		assert.notEqual(a, c);
	});
});

describe('radar coverage', () => {
	it('covers the rectangle corners, not only an inscribed circle', () => {
		const frac = lonLatToFractionalTile(LARGO_LAT, LARGO_LON, 11);
		const halfW = 400;
		const halfH = 200;
		const rect = tilesCoveringRect(frac.x, frac.y, halfW, halfH, 11);
		const circle = tilesCoveringRadius(frac.x, frac.y, Math.min(halfW, halfH), 11);
		assert.ok(rect.tiles.length >= circle.tiles.length);
		assert.ok(rect.x1 - rect.x0 >= circle.x1 - circle.x0);
	});

	it('pins 1706 Adams Cir S inside a z7 RainViewer tile pixel', () => {
		assert.equal(LARGO_LAT, 27.90218731);
		assert.equal(LARGO_LON, -82.7694744);
		const home = homeTilePixel(LARGO_LAT, LARGO_LON, 7);
		assert.ok(home.px >= 0 && home.px < TILE_SIZE);
		assert.ok(home.py >= 0 && home.py < TILE_SIZE);
		assert.equal(home.tx, 34);
		assert.equal(home.ty, 53);
	});
});
