import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAmbientStations, resetAmbientStationCache } from '../src/lib/server/ambientStations.js';

const HOME = { lat: 27.90218731, lon: -82.7694744 };

function row(name, lat, lon, tempf) {
	return {
		macAddress: name,
		info: { name, coords: { coords: { lat, lon } } },
		lastData: { dateutc: Date.parse('2026-09-13T08:00:00-04:00'), tempf, humidity: 70, baromrelin: 30 }
	};
}

describe('ambient station fetch', () => {
	beforeEach(() => {
		resetAmbientStationCache();
	});

	it('unions the tight local box with the wider neighborhood box', async () => {
		const urls = [];
		const fetchImpl = async (url) => {
			urls.push(url);
			const parsed = new URL(url);
			const south = Number(parsed.searchParams.get('$publicBox[0][1]'));
			const data =
				south > 27.84
					? [row('Gary’s 67', 27.9051, -82.7576, 81)]
					: [row('Far', 27.82, -82.70, 79)];
			return {
				ok: true,
				async json() {
					return { data };
				}
			};
		};
		const stations = await fetchAmbientStations(HOME.lat, HOME.lon, {
			now: Date.parse('2026-09-13T08:00:00-04:00'),
			fetchImpl
		});
		assert.equal(urls.length, 2);
		assert.equal(stations.length, 2);
		assert.ok(stations.some((s) => s.name === 'Gary’s 67'));
		assert.ok(stations.some((s) => s.name === 'Far'));
	});
});
