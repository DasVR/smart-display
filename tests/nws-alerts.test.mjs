import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alertTier, isExtremeAlert, islandWeatherSlip, normalizeNws, splitNwsAlerts, tickerText } from '../src/lib/nwsAlerts.js';
import { createNwsWatch, ringForWarnings } from '../src/lib/server/nwsWatch.js';
import { createAttentionHub } from '../src/lib/server/attentionHub.js';

const quiet = { log() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-10-11T18:00:00Z');
const later = (h) => new Date(NOW + h * 3600000).toISOString();

/** A feature the way api.weather.gov sends it. */
function feature(event, props = {}, geometry = null) {
	const id = props.id || `urn:oid:2.49.0.1.840.0.${event.replace(/\W/g, '')}.${props.n ?? 1}`;
	return {
		id: `https://api.weather.gov/alerts/${id}`,
		geometry,
		properties: {
			id,
			event,
			severity: 'Moderate',
			urgency: 'Expected',
			certainty: 'Likely',
			status: 'Actual',
			messageType: 'Alert',
			headline: `${event} issued by NWS Tampa Bay Ruskin FL`,
			sent: later(-1),
			expires: later(2),
			ends: later(3),
			references: [],
			...props
		}
	};
}

describe('tiers: what each alert asks of you', () => {
	it('act now: the dangerous warnings, whatever their severity field says', () => {
		for (const event of ['Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Hurricane Warning', 'Storm Surge Warning', 'Extreme Wind Warning', 'Tropical Storm Warning', 'Evacuation Immediate', 'Shelter In Place Warning']) {
			assert.equal(alertTier({ event, severity: 'Moderate' }), 'warning', event);
		}
		assert.equal(alertTier({ event: 'Flash Flood Emergency', severity: 'Extreme' }), 'warning');
		assert.equal(alertTier({ event: 'Something New', severity: 'Extreme', urgency: 'Immediate' }), 'warning', 'the feed itself says extreme and now');
		assert.equal(alertTier({ event: 'Something New', severity: 'Severe', urgency: 'Immediate', certainty: 'Observed' }), 'warning');
	});

	it('be ready: watches and the slower warnings, not a ringing wall', () => {
		for (const event of ['Tornado Watch', 'Hurricane Watch', 'Tropical Storm Watch', 'Flood Watch', 'Flood Warning', 'High Wind Warning', 'Coastal Flood Warning', 'Special Weather Statement']) {
			assert.equal(alertTier({ event, severity: 'Severe', urgency: 'Expected' }), 'watch', event);
		}
	});

	it('worth knowing: advisories and statements stay on the Weather view', () => {
		for (const event of ['Rip Current Statement', 'Heat Advisory', 'Beach Hazards Statement', 'Wind Advisory', 'Small Craft Advisory']) {
			assert.equal(alertTier({ event, severity: 'Moderate' }), 'advisory', event);
		}
	});

	it('the views follow the tiers', () => {
		assert.equal(isExtremeAlert({ event: 'Severe Thunderstorm Warning', severity: 'Severe' }), true, 'a severe thunderstorm warning is act-now');
		assert.equal(isExtremeAlert({ event: 'Tornado Watch' }), false, 'a watch is not');
		const { extreme, island } = splitNwsAlerts([{ event: 'Tornado Warning' }, { event: 'Heat Advisory' }, { event: 'Hurricane Watch' }, { event: 'Rip Current Statement' }]);
		assert.deepEqual(extreme.map((a) => a.event), ['Tornado Warning']);
		assert.deepEqual(island.map((a) => a.event), ['Hurricane Watch'], 'advisories never take the island');
	});
});

describe('the feed, cleaned up', () => {
	it('drops tests, exercises, cancellations, updated and finished alerts', () => {
		const tornado = feature('Tornado Warning', { id: 'urn:oid:t1', severity: 'Extreme', urgency: 'Immediate' }, { type: 'Polygon', coordinates: [] });
		const update = feature('Tornado Warning', { id: 'urn:oid:t2', messageType: 'Update', references: [{ identifier: 'urn:oid:t1' }] }, { type: 'Polygon', coordinates: [] });
		const list = normalizeNws(
			{
				features: [
					tornado,
					update,
					feature('Tornado Warning', { id: 'urn:oid:x', status: 'Test' }),
					feature('Tornado Warning', { id: 'urn:oid:y', status: 'Exercise' }),
					feature('Flood Watch', { id: 'urn:oid:c', messageType: 'Cancel' }),
					feature('Heat Advisory', { id: 'urn:oid:old', ends: later(-0.5), expires: later(-0.5) }),
					feature('Rip Current Statement', { id: 'urn:oid:r' }),
					feature('Hurricane Watch', { id: 'urn:oid:h', severity: 'Severe' })
				]
			},
			NOW
		);
		assert.deepEqual(list.map((a) => a.id), ['urn:oid:t2', 'urn:oid:h', 'urn:oid:r'], 'the update replaces the original; warnings first');
		assert.equal(list[0].polygon, true, 'storm-based warning');
		assert.equal(list[0].tier, 'warning');
		assert.deepEqual(list[0].references, ['urn:oid:t1']);
		assert.equal(list[2].headline, 'Rip Current Statement issued by NWS Tampa Bay Ruskin FL');
	});

	it('an empty or broken feed is just no alerts', () => {
		assert.deepEqual(normalizeNws({ features: [] }, NOW), []);
		assert.deepEqual(normalizeNws(null, NOW), []);
	});
});

describe('the island and the ticker', () => {
	it('rolls event plus headline into ticker copy', () => {
		assert.equal(
			tickerText([
				{ event: 'Tornado Warning', headline: 'Tornado Warning for Pinellas until 7 PM' },
				{ event: 'Hurricane Watch', headline: 'Coastal Hillsborough' }
			]),
			'Tornado Warning for Pinellas until 7 PM   ·   Hurricane Watch: Coastal Hillsborough'
		);
		assert.equal(tickerText([]), '');
	});

	it('island: rain, or a watch; never an advisory, never an act-now warning (that rings instead)', () => {
		const rain = islandWeatherSlip({
			alerts: [{ event: 'Tornado Warning' }],
			prediction: { approaching: true, etaMin: 12, rain60min: 0.7, source: 'nowcast+forecast' },
			current: { windSpeed: 14, windDirection: 80 }
		});
		assert.equal(rain.kicker, 'Radar');
		assert.equal(rain.title, 'Rain in 12 min');
		assert.match(rain.extra, /14 mph/);

		const watch = islandWeatherSlip({ alerts: [{ id: 'w1', event: 'Tornado Watch', headline: 'Until 9 PM EDT' }], prediction: {} });
		assert.equal(watch.active, true);
		assert.equal(watch.title, 'Tornado Watch');
		assert.equal(watch.chimeKey, 'nws:w1', 'keyed by alert, so a new watch pings again');

		assert.equal(islandWeatherSlip({ alerts: [{ event: 'Rip Current Statement' }], prediction: {} }).active, false);
		assert.equal(islandWeatherSlip({ alerts: [{ event: 'Tornado Warning' }], prediction: { rain60min: 0.1 } }).active, false);
	});
});

describe('the watcher', () => {
	function fakeNws(features) {
		const calls = [];
		let state = { features, etag: 'W/"1"', fail: false };
		const impl = async (url, init) => {
			calls.push({ url, headers: init.headers });
			if (state.fail) throw new Error('offline');
			if (init.headers['If-None-Match'] === state.etag) return new Response(null, { status: 304 });
			return new Response(JSON.stringify({ features: state.features }), { status: 200, headers: { etag: state.etag } });
		};
		return { impl, calls, set: (patch) => (state = { ...state, ...patch }) };
	}

	it('asks politely, uses the ETag, and reports what changed', async () => {
		const nws = fakeNws([feature('Rip Current Statement', { id: 'urn:oid:r' })]);
		const changes = [];
		const w = createNwsWatch({ lat: 27.902187, lon: -82.769474, fetchImpl: nws.impl, now: () => NOW, log: quiet });
		w.subscribe((alerts, diff) => changes.push({ ids: alerts.map((a) => a.id), added: diff.added.map((a) => a.id), removed: diff.removed.map((a) => a.id) }));

		await w.check();
		assert.match(nws.calls[0].url, /alerts\/active\?point=27\.9022,-82\.7695&status=actual$/);
		assert.match(nws.calls[0].headers['User-Agent'], /smart-display/, 'NWS asks every client to say who it is');
		assert.equal(nws.calls[0].headers.Accept, 'application/geo+json');
		assert.deepEqual(changes, [{ ids: ['urn:oid:r'], added: ['urn:oid:r'], removed: [] }]);

		await w.check();
		assert.equal(nws.calls[1].headers['If-None-Match'], 'W/"1"', 'unchanged feed: a 304');
		assert.equal(changes.length, 1, 'nothing new, nothing announced');

		nws.set({ features: [feature('Tornado Warning', { id: 'urn:oid:t' }), feature('Rip Current Statement', { id: 'urn:oid:r' })], etag: 'W/"2"' });
		await w.check();
		assert.deepEqual(changes.at(-1), { ids: ['urn:oid:t', 'urn:oid:r'], added: ['urn:oid:t'], removed: [] });
		assert.equal(w.status().stale, false);
	});

	it('a failed check keeps the last good list instead of clearing the sky', async () => {
		let t = NOW;
		const nws = fakeNws([feature('Tornado Watch', { id: 'urn:oid:w', ends: new Date(NOW + 20 * 60000).toISOString() })]);
		const w = createNwsWatch({ lat: 0, lon: 0, fetchImpl: nws.impl, now: () => t, log: quiet });
		await w.check();
		nws.set({ fail: true });
		t += 60000;
		assert.deepEqual((await w.check()).map((a) => a.id), ['urn:oid:w']);
		t += 6 * 60000;
		await w.check();
		assert.equal(w.status().stale, true, 'says so after a few minutes');
		t += 20 * 60000;
		assert.deepEqual(await w.check(), [], 'but an alert still ends on its own clock');
	});

	it('wiring: a warning rings, its update keeps ringing quietly, its end settles it', async () => {
		const hub = createAttentionHub({ now: () => NOW, log: quiet });
		const nws = fakeNws([feature('Tornado Warning', { id: 'urn:oid:t1' })]);
		const w = createNwsWatch({ lat: 0, lon: 0, fetchImpl: nws.impl, now: () => NOW, log: quiet });
		ringForWarnings(w, hub);
		await w.check();
		const first = hub.snapshot()[0];
		assert.equal(first.ref, 'nws:urn:oid:t1');
		assert.equal(first.kind, 'severe');

		nws.set({ features: [feature('Tornado Warning', { id: 'urn:oid:t2', messageType: 'Update', headline: 'Tornado Warning extended', references: [{ identifier: 'urn:oid:t1' }] })], etag: 'W/"2"' });
		await w.check();
		assert.equal(hub.count(), 1);
		assert.equal(hub.snapshot()[0].id, first.id, 'same item: no fresh ringing for an update');
		assert.equal(hub.snapshot()[0].ref, 'nws:urn:oid:t2');
		assert.equal(hub.snapshot()[0].body, 'Tornado Warning extended');

		nws.set({ features: [feature('Tornado Watch', { id: 'urn:oid:w' })], etag: 'W/"3"' });
		await w.check();
		assert.equal(hub.count(), 0, 'the warning ended: the wall goes quiet by itself');
		hub.stop();
	});
});
