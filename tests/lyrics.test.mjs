import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	lyricsFromHit,
	parseLRC,
	pickBestLyricsHit,
	scoreLyricsHit
} from '../src/lib/server/lyrics.js';

const limpMyWay = {
	trackName: 'My Way',
	artistName: 'Limp Bizkit',
	albumName: 'Chocolate Starfish and the Hot Dog Flavored Water',
	duration: 273,
	syncedLyrics: '[00:12.00]You can take it all\n[00:16.00]Just do not mess with me'
};

const sinatraMyWay = {
	trackName: 'My Way',
	artistName: 'Frank Sinatra',
	albumName: 'My Way',
	duration: 275,
	plainLyrics: 'And now, the end is near'
};

test('parseLRC reads timed lines', () => {
	const lines = parseLRC('[00:12.50]Hello\n[01:02]World');
	assert.equal(lines[0].time, 12.5);
	assert.equal(lines[0].text, 'Hello');
	assert.equal(lines[1].time, 62);
});

test('scoreLyricsHit rejects a same-title different-artist match', () => {
	const query = {
		artist: 'Limp Bizkit',
		title: 'My Way',
		album: 'Chocolate Starfish and the Hot Dog Flavored Water',
		duration: 273
	};
	assert.ok(scoreLyricsHit(limpMyWay, query) >= 70);
	assert.equal(scoreLyricsHit(sinatraMyWay, query), 0);
});

test('pickBestLyricsHit ignores a popular wrong My Way', () => {
	const picked = pickBestLyricsHit([sinatraMyWay, limpMyWay], {
		artist: 'Limp Bizkit',
		title: 'My Way',
		album: 'Chocolate Starfish and the Hot Dog Flavored Water',
		duration: 273
	});
	assert.equal(picked.artistName, 'Limp Bizkit');
	const lines = lyricsFromHit(picked);
	assert.equal(lines[0].text, 'You can take it all');
});
