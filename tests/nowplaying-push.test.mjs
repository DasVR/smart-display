import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	NOWPLAYING_POLL_IDLE_MS,
	NOWPLAYING_POLL_LIVE_MS,
	NOWPLAYING_POLL_SEEK_MS,
	compactNowPlaying,
	isLiveNowPlaying,
	nowPlayingPollMs,
	nowPlayingPushKind,
	nowPlayingPushPayload
} from '../src/lib/server/nowPlayingPush.js';

const live = {
	playing: true,
	paused: false,
	title: 'Daylight',
	artist: 'Taylor Swift',
	position: 10,
	positionAt: 1_000,
	length: 200,
	lyrics: [{ time: 1, text: 'one' }]
};

test('isLiveNowPlaying treats a titled pause as a session', () => {
	assert.equal(isLiveNowPlaying({ playing: false }), false);
	assert.equal(isLiveNowPlaying({ playing: false, paused: true, title: 'Daylight' }), true);
});

test('nowPlayingPushKind fires connect and disconnect immediately', () => {
	assert.equal(nowPlayingPushKind({ playing: false }, live), 'connect');
	assert.equal(nowPlayingPushKind(live, { playing: false }), 'disconnect');
});

test('nowPlayingPushKind ignores ordinary clock advance', () => {
	const next = { ...live, position: 11, positionAt: 2_000 };
	assert.equal(nowPlayingPushKind(live, next, 2_000), null);
});

test('nowPlayingPushKind fires on scrub, skip, and play/pause', () => {
	assert.equal(nowPlayingPushKind(live, { ...live, position: 80, positionAt: 5_000 }, 5_000), 'seek');
	assert.equal(nowPlayingPushKind(live, { ...live, seeking: true }, 1_000), 'seek');
	assert.equal(nowPlayingPushKind(live, { ...live, playing: false, paused: true }, 2_000), 'transport');
	assert.equal(nowPlayingPushKind(live, { ...live, title: 'My Way' }, 2_000), 'track');
});

test('nowPlayingPollMs tightens while a session is live or seeking', () => {
	assert.equal(nowPlayingPollMs({ playing: false }), NOWPLAYING_POLL_IDLE_MS);
	assert.equal(nowPlayingPollMs(live), NOWPLAYING_POLL_LIVE_MS);
	assert.equal(nowPlayingPollMs({ ...live, seeking: true }), NOWPLAYING_POLL_SEEK_MS);
});

test('compactNowPlaying omits lyrics so a 400ms tick stays small', () => {
	const compact = compactNowPlaying(live);
	assert.equal(compact.title, 'Daylight');
	assert.equal('lyrics' in compact, false);
});

test('nowPlayingPushPayload attaches lyrics on connect and track change', () => {
	const connect = nowPlayingPushPayload(live, 'connect');
	assert.equal(connect.type, 'nowPlaying');
	assert.equal(connect.kind, 'connect');
	assert.equal(connect.lyrics[0].text, 'one');
	const seek = nowPlayingPushPayload(live, 'seek');
	assert.equal('lyrics' in seek, false);
});
