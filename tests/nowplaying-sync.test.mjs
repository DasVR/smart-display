import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeNowPlayingSample, OPTIMISTIC_HOLD_MS } from '../src/lib/nowPlayingMerge.js';

const live = {
	playing: true,
	paused: false,
	title: 'Daylight',
	position: 10,
	positionAt: 1_000,
	length: 200
};

test('mergeNowPlayingSample lets disconnect win immediately', () => {
	const held = { ...live, playing: false, paused: true, optimisticUntil: 5_000 };
	const merged = mergeNowPlayingSample(held, { playing: false }, 1_200);
	assert.equal(merged.playing, false);
	assert.equal(merged.title, undefined);
});

test('mergeNowPlayingSample keeps an optimistic pause over a stale playing poll', () => {
	const held = {
		...live,
		playing: false,
		paused: true,
		position: 12,
		positionAt: 3_000,
		optimisticUntil: 3_000 + OPTIMISTIC_HOLD_MS
	};
	const merged = mergeNowPlayingSample(held, { ...live, position: 10 }, 3_200);
	assert.equal(merged.playing, false);
	assert.equal(merged.paused, true);
	assert.equal(merged.position, 12);
});

test('mergeNowPlayingSample accepts the server once play/pause matches', () => {
	const held = {
		...live,
		playing: false,
		paused: true,
		optimisticUntil: 3_000 + OPTIMISTIC_HOLD_MS
	};
	const incoming = { ...live, playing: false, paused: true, position: 12, positionAt: 3_400 };
	const merged = mergeNowPlayingSample(held, incoming, 3_200);
	assert.equal(merged.playing, false);
	assert.equal(merged.position, 12);
	assert.equal(merged.optimisticUntil, 0);
});

test('mergeNowPlayingSample keeps a local seek until the player lands nearby', () => {
	const held = {
		...live,
		position: 80,
		positionAt: 4_000,
		seeking: true,
		optimisticUntil: 4_000 + OPTIMISTIC_HOLD_MS
	};
	const stale = mergeNowPlayingSample(held, { ...live, position: 10, seeking: false }, 4_200);
	assert.equal(stale.position, 80);
	assert.equal(stale.seeking, true);

	const landed = mergeNowPlayingSample(
		held,
		{ ...live, position: 80.4, positionAt: 4_300, seeking: false },
		4_300
	);
	assert.equal(landed.position, 80.4);
	assert.equal(landed.optimisticUntil, 0);
});

test('mergeNowPlayingSample does not rewind lyrics on a restamped progress sample', () => {
	const current = { ...live, playing: true, position: 10, positionAt: 1_000 };
	const restamp = { ...live, playing: true, position: 10, positionAt: 6_000 };
	const merged = mergeNowPlayingSample(current, restamp, 6_000);
	assert.equal(merged.position, 10);
	assert.equal(merged.positionAt, 1_000);
});

test('mergeNowPlayingSample ignores a dropped zero sample mid-track', () => {
	const current = { ...live, playing: true, position: 40, positionAt: 1_000 };
	const dropped = { ...live, playing: true, position: 0, positionAt: 5_000 };
	const merged = mergeNowPlayingSample(current, dropped, 5_000);
	assert.equal(merged.position, 40);
	assert.equal(merged.positionAt, 1_000);
});

test('mergeNowPlayingSample still accepts a flush seek backward', () => {
	const current = { ...live, playing: true, position: 40, positionAt: 1_000 };
	const seeked = { ...live, playing: true, position: 12, positionAt: 5_000, seeking: true };
	const merged = mergeNowPlayingSample(current, seeked, 5_000);
	assert.equal(merged.position, 12);
	assert.equal(merged.seeking, true);
});

test('mergeNowPlayingSample takes a later real progress report', () => {
	const current = { ...live, playing: true, position: 10, positionAt: 1_000 };
	const prgr = { ...live, playing: true, position: 14.2, positionAt: 5_000 };
	const merged = mergeNowPlayingSample(current, prgr, 5_000);
	assert.equal(merged.position, 14.2);
	assert.equal(merged.positionAt, 5_000);
});

test('mergeNowPlayingSample accepts a post-flush scrub landing behind the old clock', () => {
	const current = { ...live, playing: true, position: 40, positionAt: 1_000, seeking: true };
	const landed = { ...live, playing: true, position: 12, positionAt: 5_000, seeking: false };
	const merged = mergeNowPlayingSample(current, landed, 5_000);
	assert.equal(merged.position, 12);
	assert.equal(merged.positionAt, 5_000);
	assert.equal(merged.seeking, false);
});

test('mergeNowPlayingSample accepts an AirPlay scrub that skipped the flush flag', () => {
	const current = { ...live, playing: true, source: 'airplay', position: 40, positionAt: 1_000 };
	const scrub = { ...live, playing: true, source: 'airplay', position: 12, positionAt: 5_000 };
	const merged = mergeNowPlayingSample(current, scrub, 5_000);
	assert.equal(merged.position, 12);
	assert.equal(merged.positionAt, 5_000);
});

test('mergeNowPlayingSample accepts an AirPlay skip back to the start', () => {
	const current = { ...live, playing: true, source: 'airplay', position: 40, positionAt: 1_000 };
	const skipStart = { ...live, playing: true, source: 'airplay', position: 0.2, positionAt: 5_000 };
	const merged = mergeNowPlayingSample(current, skipStart, 5_000);
	assert.equal(merged.position, 0.2);
	assert.equal(merged.positionAt, 5_000);
});

test('mergeNowPlayingSample takes a new song clock even if the old one was ahead', () => {
	const current = { ...live, playing: true, title: 'My Way', position: 40, positionAt: 1_000 };
	const next = { ...live, playing: true, title: 'Daylight', position: 1.4, positionAt: 5_000 };
	const merged = mergeNowPlayingSample(current, next, 5_000);
	assert.equal(merged.title, 'Daylight');
	assert.equal(merged.position, 1.4);
	assert.equal(merged.positionAt, 5_000);
});

test('mergeNowPlayingSample takes a paused AirPlay sample instead of dropping the track', () => {
	const current = { ...live, playing: true, source: 'airplay', position: 40, positionAt: 1_000 };
	const paused = {
		...live,
		playing: false,
		paused: true,
		source: 'airplay',
		position: 44.2,
		positionAt: 5_200
	};
	const merged = mergeNowPlayingSample(current, paused, 5_200);
	assert.equal(merged.playing, false);
	assert.equal(merged.paused, true);
	assert.equal(merged.title, 'Daylight');
	assert.equal(merged.position, 44.2);
});
