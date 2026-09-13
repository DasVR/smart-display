import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	INHG_TO_HPA,
	applyMeshToCurrent,
	barycentricWeights,
	backyardToSample,
	containingTriangle,
	dedupeStations,
	estimateAt,
	inHgToHpa,
	normalizeUtc,
	parsePublicDevice,
	pointInTriangle,
	publicDevicesUrl
} from '../src/lib/ambientMesh.js';

const HOME = { lat: 27.90218731, lon: -82.7694744 };
const NOW = Date.parse('2026-09-13T08:00:00-04:00');

function station(partial) {
	return {
		mac: partial.mac || partial.name || 'x',
		name: partial.name || 'x',
		lat: partial.lat,
		lon: partial.lon,
		ts: partial.ts ?? NOW,
		tempf: partial.tempf ?? null,
		humidity: partial.humidity ?? null,
		windspeedmph: partial.windspeedmph ?? null,
		winddir: partial.winddir ?? null,
		windgustmph: partial.windgustmph ?? null,
		baromrelin: partial.baromrelin ?? null,
		baromabsin: partial.baromabsin ?? null,
		pressureHpa: partial.pressureHpa ?? inHgToHpa(partial.baromrelin ?? partial.baromabsin),
		rainin: partial.rainin ?? null
	};
}

describe('ambient mesh units', () => {
	it('converts inches of mercury to hPa and leaves hPa alone', () => {
		assert.equal(Math.round(inHgToHpa(30) * 10) / 10, Math.round(30 * INHG_TO_HPA * 10) / 10);
		assert.equal(inHgToHpa(1013.2), 1013.2);
		assert.equal(inHgToHpa(null), null);
	});

	it('treats Ambient dateutc seconds as milliseconds', () => {
		assert.equal(normalizeUtc(1789276200), 1789276200000);
		assert.equal(normalizeUtc(1789276200000), 1789276200000);
		assert.equal(normalizeUtc(0), 0);
	});

	it('builds the public map box query the lightning API expects', () => {
		const url = publicDevicesUrl(HOME.lat, HOME.lon, 3.5, 200);
		assert.match(url, /lightning\.ambientweather\.net\/devices\?/);
		assert.match(url, /%24publicBox/);
		assert.match(url, /%24limit=200/);
	});
});

describe('parse and dedupe', () => {
	it('reads lastData off a public map row', () => {
		const row = {
			macAddress: 'AA:BB',
			info: { name: 'Gary’s 67', coords: { coords: { lat: 27.9051, lon: -82.7576 } } },
			lastData: {
				dateutc: NOW,
				tempf: 81.1,
				humidity: 88,
				baromrelin: 29.876,
				windspeedmph: 0.4,
				winddir: 154,
				hourlyrainin: 0
			}
		};
		const s = parsePublicDevice(row);
		assert.equal(s.name, 'Gary’s 67');
		assert.equal(s.tempf, 81.1);
		assert.ok(Math.abs(s.pressureHpa - 29.876 * INHG_TO_HPA) < 0.02);
	});

	it('keeps the newer of two listings on the same yard', () => {
		const a = station({ lat: 27.9094665, lon: -82.7873244, tempf: 70, ts: NOW - 60_000, name: 'old' });
		const b = station({ lat: 27.9094665, lon: -82.7873244, tempf: 81, ts: NOW, name: 'new' });
		const out = dedupeStations([a, b]);
		assert.equal(out.length, 1);
		assert.equal(out[0].tempf, 81);
	});
});

describe('triangulation', () => {
	const north = station({ name: 'N', lat: 27.92, lon: -82.769, tempf: 70, humidity: 40, pressureHpa: 1010 });
	const se = station({ name: 'SE', lat: 27.89, lon: -82.75, tempf: 80, humidity: 50, pressureHpa: 1016 });
	const sw = station({ name: 'SW', lat: 27.89, lon: -82.79, tempf: 90, humidity: 60, pressureHpa: 1022 });

	it('finds a containing triangle around Adams Circle', () => {
		assert.equal(pointInTriangle(HOME, north, se, sw), true);
		const tri = containingTriangle(
			[north, se, sw].map((s) => ({ ...s, dist: 1 })),
			HOME
		);
		assert.ok(tri);
		assert.equal(tri.length, 3);
	});

	it('interpolates temperature with barycentric weights', () => {
		const w = barycentricWeights(HOME, north, se, sw);
		assert.ok(w);
		assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-9);
		const mesh = estimateAt([north, se, sw], HOME, NOW);
		assert.equal(mesh.method, 'triangle');
		assert.equal(mesh.stationCount, 3);
		const expected = w[0] * 70 + w[1] * 80 + w[2] * 90;
		assert.ok(Math.abs(mesh.temp - expected) < 0.15);
		assert.ok(mesh.pressureHpa > 1010 && mesh.pressureHpa < 1022);
	});
});

describe('estimateAt filters', () => {
	it('drops stale and wild outlier temperatures then falls back to IDW', () => {
		const close = station({
			name: 'close',
			lat: 27.9051,
			lon: -82.7576,
			tempf: 81,
			humidity: 70,
			pressureHpa: 1015
		});
		const far = station({
			name: 'far',
			lat: 27.86,
			lon: -82.80,
			tempf: 79,
			humidity: 72,
			pressureHpa: 1014
		});
		const hot = station({ name: 'hot', lat: 27.90, lon: -82.76, tempf: 120 });
		const stale = station({
			name: 'stale',
			lat: 27.91,
			lon: -82.77,
			tempf: 50,
			ts: NOW - 60 * 60 * 1000
		});
		const mesh = estimateAt([close, far, hot, stale], HOME, NOW);
		assert.equal(mesh.stationCount, 2);
		assert.equal(mesh.method, 'idw');
		assert.ok(mesh.temp > 79 && mesh.temp < 82);
	});

	it('lets a fresh backyard station sit at home inside the mesh', () => {
		const yard = backyardToSample(
			{ tempf: 82.4, humidity: 77, baromrelin: 30.02, ts: NOW, mac: 'yard' },
			HOME
		);
		const neighbor = station({
			name: 'n',
			lat: 27.91,
			lon: -82.78,
			tempf: 80,
			humidity: 70,
			pressureHpa: 1013
		});
		const mesh = estimateAt([yard, neighbor], HOME, NOW);
		assert.ok(mesh.stationCount >= 1);
		assert.ok(Math.abs(mesh.temp - 82.4) < 2);
		assert.ok(mesh.pressureHpa > 1000);
	});

	it('writes mesh readings onto the Open-Meteo current object', () => {
		const merged = applyMeshToCurrent(
			{ temp: 90, humidity: 10, pressure: 1000, desc: 'Clear' },
			{ method: 'triangle', temp: 81.2, humidity: 77, pressureHpa: 1014.5, stationCount: 12 }
		);
		assert.equal(merged.temp, 81.2);
		assert.equal(merged.humidity, 77);
		assert.equal(merged.pressure, 1014.5);
		assert.equal(merged.desc, 'Clear');
		assert.equal(merged.mesh.stationCount, 12);
	});
});
