import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	AIRPLAY_STALE_MS,
	AIRPLAY_PAUSED_STALE_MS,
	mergeNowPlaying,
	readAirplayNowPlaying
} from '../src/lib/server/audioNowPlaying.js';

test('mergeNowPlaying keeps an AirPlay title after a flush/pause', () => {
	const merged = mergeNowPlaying(
		{ playing: false },
		{ playing: false, paused: true, title: 'My Way', artist: 'Limp Bizkit', album: 'Chocolate Starfish' }
	);
	assert.equal(merged.source, 'airplay');
	assert.equal(merged.title, 'My Way');
	assert.equal(merged.playing, false);
	assert.equal(merged.paused, true);
});

test('mergeNowPlaying does not treat a leftover AirPlay title as a session', () => {
	const merged = mergeNowPlaying(
		{ playing: false },
		{ playing: false, paused: false, title: 'Ghost track', artist: 'Gone' }
	);
	assert.equal(merged.playing, false);
	assert.equal(merged.title, undefined);
	assert.equal(merged.source, undefined);
});

test('mergeNowPlaying prefers live AirPlay over idle MPRIS', () => {
	const merged = mergeNowPlaying(
		{ playing: false },
		{ playing: true, title: 'Daylight', artist: 'Taylor Swift', album: 'Lover' }
	);
	assert.equal(merged.source, 'airplay');
	assert.equal(merged.title, 'Daylight');
	assert.equal(merged.playing, true);
});

test('mergeNowPlaying keeps the AirPlay sample timestamp', () => {
	const merged = mergeNowPlaying(
		{ playing: false, position: 3, positionAt: 50 },
		{
			playing: true,
			title: 'Daylight',
			position: 12.4,
			positionAt: 1_700_000_000_123,
			updatedAt: 1_700_000_001_000,
			length: 237
		}
	);
	assert.equal(merged.position, 12.4);
	assert.equal(merged.positionAt, 1_700_000_000_123);
	assert.equal(merged.length, 237);
});

test('mergeNowPlaying passes through the seeking flag from an AirPlay flush', () => {
	const mid = mergeNowPlaying(
		{ playing: false },
		{ playing: true, title: 'Daylight', position: 12.4, positionAt: 1_700_000_000_000, seeking: true }
	);
	assert.equal(mid.seeking, true);

	const settled = mergeNowPlaying(
		{ playing: false },
		{ playing: true, title: 'Daylight', position: 40, positionAt: 1_700_000_005_000, seeking: false }
	);
	assert.equal(settled.seeking, false);
});

test('mergeNowPlaying keeps a playing Bluetooth/MPRIS track', () => {
	const merged = mergeNowPlaying(
		{ playing: true, title: 'BT track', artist: 'Phone' },
		{ playing: false }
	);
	assert.equal(merged.source, 'mpris');
	assert.equal(merged.title, 'BT track');
});

test('mergeNowPlaying AirPlay wins over a paused leftover MPRIS player', () => {
	const merged = mergeNowPlaying(
		{ playing: false, title: 'Old Bluetooth song', artist: 'Phone' },
		{ playing: true, title: 'AirPlay song', artist: 'Apple Music' }
	);
	assert.equal(merged.source, 'airplay');
	assert.equal(merged.title, 'AirPlay song');
});

test('mergeNowPlaying discards MPRIS state when Bluetooth is not connected', () => {
	const merged = mergeNowPlaying(
		{ playing: true, title: 'Stale phone track', artist: 'Phone' },
		{ playing: false },
		{ bluetoothConnected: false }
	);
	assert.equal(merged.playing, false);
	assert.equal(merged.title, undefined);
});

test('mergeNowPlaying still trusts MPRIS when Bluetooth is connected', () => {
	const merged = mergeNowPlaying(
		{ playing: true, title: 'Live phone track', artist: 'Phone' },
		{ playing: false },
		{ bluetoothConnected: true }
	);
	assert.equal(merged.playing, true);
	assert.equal(merged.title, 'Live phone track');
});

test('mergeNowPlaying defaults to trusting MPRIS when connection state is unknown', () => {
	const merged = mergeNowPlaying({ playing: true, title: 'Unspecified', artist: 'Phone' }, { playing: false });
	assert.equal(merged.playing, true);
});

test('readAirplayNowPlaying treats stale files as not playing', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'airplay-np-'));
	const file = path.join(dir, 'now.json');
	const now = 1_700_000_000_000;
	writeFileSync(
		file,
		JSON.stringify({
			playing: true,
			title: 'Gone',
			artist: 'Old',
			updatedAt: now - AIRPLAY_STALE_MS - 1000
		})
	);
	const stale = readAirplayNowPlaying(file, now);
	assert.equal(stale.stale, true);
	assert.equal(stale.playing, false);
	assert.equal(mergeNowPlaying({ playing: false }, stale).playing, false);
});

test('readAirplayNowPlaying returns live state', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'airplay-np-'));
	const file = path.join(dir, 'now.json');
	const now = 1_700_000_000_000;
	writeFileSync(
		file,
		JSON.stringify({
			playing: true,
			title: 'Cardigan',
			artist: 'Taylor Swift',
			updatedAt: now - 1000
		})
	);
	const live = readAirplayNowPlaying(file, now);
	assert.equal(live.playing, true);
	assert.equal(live.title, 'Cardigan');
});

test('readAirplayNowPlaying treats a paused file without heartbeats as disconnected', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'airplay-np-'));
	const file = path.join(dir, 'now.json');
	const now = 1_700_000_000_000;
	writeFileSync(
		file,
		JSON.stringify({
			playing: false,
			paused: true,
			title: 'My Way',
			updatedAt: now - AIRPLAY_PAUSED_STALE_MS - 500
		})
	);
	const stale = readAirplayNowPlaying(file, now);
	assert.equal(stale.stale, true);
	assert.equal(stale.paused, false);
	assert.equal(mergeNowPlaying({ playing: false }, stale).title, undefined);
});
