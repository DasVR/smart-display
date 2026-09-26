import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	classifyPlayerctlFailure,
	isBluetoothMprisPlayer,
	musicFaultFromText,
	musicFaultMessage,
	parsePlayerctlMetadata,
	pickMprisPlayer,
	prettyPlayerName
} from '../src/lib/mprisPlayers.js';
import { assembleNowPlaying } from '../src/lib/server/nowPlayingAssemble.js';
import { pickPlayerctlBin } from '../src/lib/server/playerctlBin.js';

const row = (player, status, title, artist = 'Someone') =>
	[player, status, artist, title, 'Album', '', '12.5', '180000000'].join('\x1f');

test('parsePlayerctlMetadata reads one row per program', () => {
	const players = parsePlayerctlMetadata(`${row('spotify', 'Playing', 'Daylight')}\n${row('bluez', 'Paused', 'Old')}`);
	assert.equal(players.length, 2);
	assert.equal(players[0].player, 'spotify');
	assert.equal(players[0].title, 'Daylight');
	assert.equal(players[0].length, 180);
});

test('pickMprisPlayer stays on the program already showing', () => {
	const players = parsePlayerctlMetadata(
		`${row('spotify', 'Playing', 'Daylight')}\n${row('chromium.instance1', 'Playing', 'Other')}`
	);
	assert.equal(pickMprisPlayer(players, { prefer: 'chromium.instance1' }).title, 'Other');
	assert.equal(pickMprisPlayer(players).player, 'spotify');
});

test('pickMprisPlayer prefers a local program over a phone when nothing is pinned', () => {
	const players = parsePlayerctlMetadata(`${row('bluez', 'Playing', 'Phone')}\n${row('spotify', 'Playing', 'Desk')}`);
	assert.equal(pickMprisPlayer(players).title, 'Desk');
});

test('pickMprisPlayer drops BlueZ only when Bluetooth is confirmed down', () => {
	const players = parsePlayerctlMetadata(`${row('bluez', 'Playing', 'Phone')}\n${row('spotify', 'Paused', 'Desk')}`);
	assert.equal(pickMprisPlayer(players, { dropBluetooth: true }).title, 'Desk');
	assert.equal(pickMprisPlayer(players).title, 'Phone');
	assert.equal(isBluetoothMprisPlayer('org.bluez.MediaPlayer'), true);
	assert.equal(prettyPlayerName('chromium.instance9'), 'Chromium');
	assert.equal(prettyPlayerName('org.mpris.MediaPlayer2.mpv'), 'Mpv');
});

test('pickPlayerctlBin uses the first real path', () => {
	assert.equal(pickPlayerctlBin([]), '');
	assert.equal(pickPlayerctlBin(['', '/usr/bin/playerctl', '/snap/bin/playerctl']), '/usr/bin/playerctl');
});

test('classifyPlayerctlFailure separates silence from a broken tool', () => {
	assert.equal(classifyPlayerctlFailure({ code: 'ENOENT', message: 'spawn playerctl ENOENT' }), 'missing');
	assert.equal(classifyPlayerctlFailure({ killed: true, message: 'timed out' }), 'timeout');
	assert.equal(classifyPlayerctlFailure({ status: 1, stderr: 'No players found' }), 'idle');
	assert.equal(musicFaultMessage('timeout'), 'The music player took too long to answer');
	assert.equal(musicFaultFromText('No players found'), 'idle');
	assert.equal(musicFaultFromText('spawn playerctl ENOENT'), 'missing');
	assert.equal(musicFaultMessage('idle'), 'No music player is open on the display');
	assert.equal(musicFaultMessage('missing'), 'Music controls are not installed on the display');
});

test('assembleNowPlaying reports a playerctl failure instead of an empty deck', () => {
	const failed = assembleNowPlaying({ playerError: 'timeout', airplay: { playing: false } });
	assert.equal(failed.track.unavailable, true);
	assert.equal(failed.track.reason, 'timeout');
	assert.equal(failed.track.playing, false);
});

test('assembleNowPlaying keeps AirPlay up when local controls fail', () => {
	const air = assembleNowPlaying({
		playerError: 'missing',
		airplay: { playing: true, title: 'Cardigan', artist: 'Taylor Swift', paused: false }
	});
	assert.equal(air.track.source, 'airplay');
	assert.equal(air.track.title, 'Cardigan');
	assert.equal(air.track.degraded, 'playerctl');
	assert.equal(air.track.unavailable, false);
});

test('assembleNowPlaying warns when phone audio is live but Bluetooth did not answer', () => {
	const phone = assembleNowPlaying({
		playersText: row('bluez', 'Playing', 'Phone track'),
		bluetoothError: 'timeout',
		dropBluetooth: false
	});
	assert.equal(phone.track.title, 'Phone track');
	assert.equal(phone.track.degraded, 'bluetooth');
	assert.equal(phone.track.playing, true);
});
