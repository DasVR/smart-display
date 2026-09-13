import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	AIRPLAY_STALE_MS,
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

test('mergeNowPlaying prefers live AirPlay over idle MPRIS', () => {
	const merged = mergeNowPlaying(
		{ playing: false },
		{ playing: true, title: 'Daylight', artist: 'Taylor Swift', album: 'Lover' }
	);
	assert.equal(merged.source, 'airplay');
	assert.equal(merged.title, 'Daylight');
	assert.equal(merged.playing, true);
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
