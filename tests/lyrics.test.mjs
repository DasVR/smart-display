import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	fetchLyrics,
	lyricsFromHit,
	parseLRC,
	pickBestLyricsHit,
	pickItunesDuration,
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

test('parseLRC applies offset and skips id3 tags', () => {
	const lines = parseLRC(
		'[ti:My Way]\n[ar:Limp Bizkit]\n[length:04:33]\n[offset:-200]\n[00:12.00]You can take it all\n[00:16.00]'
	);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].text, 'You can take it all');
	assert.equal(lines[0].time, 11.8);
});

test('parseLRC reads enhanced word clocks', () => {
	const lines = parseLRC('[00:12.00]<00:12.00>You <00:12.40>can <00:12.80>take');
	assert.equal(lines[0].text, 'You can take');
	assert.equal(lines[0].words.length, 3);
	assert.equal(lines[0].words[1].text, 'can');
	assert.equal(lines[0].words[1].time, 12.4);
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

test('pickItunesDuration prefers the matching artist duration', () => {
	const duration = pickItunesDuration(
		[
			{ trackName: 'My Way', artistName: 'Frank Sinatra', trackTimeMillis: 275000 },
			{
				trackName: 'My Way',
				artistName: 'Limp Bizkit',
				collectionName: 'Chocolate Starfish and the Hot Dog Flavored Water',
				trackTimeMillis: 273000
			}
		],
		{
			artist: 'Limp Bizkit',
			title: 'My Way',
			album: 'Chocolate Starfish and the Hot Dog Flavored Water'
		}
	);
	assert.equal(duration, 273);
});

test('fetchLyrics asks LRCLIB /api/get with duration', async () => {
	const urls = [];
	const load = async (url) => {
		urls.push(url);
		if (url.includes('/api/get')) {
			return {
				trackName: 'My Way',
				artistName: 'Limp Bizkit',
				albumName: 'Chocolate Starfish and the Hot Dog Flavored Water',
				duration: 273,
				syncedLyrics: '[00:12.00]You can take it all'
			};
		}
		throw new Error('unexpected ' + url);
	};
	const lines = await fetchLyrics('Limp Bizkit', 'My Way', {
		album: 'Chocolate Starfish and the Hot Dog Flavored Water',
		duration: 273.4,
		load
	});
	assert.match(urls[0], /duration=273/);
	assert.equal(lines[0].text, 'You can take it all');
});
