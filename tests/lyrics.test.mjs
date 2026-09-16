import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventEmitter } from 'node:events';

import {
	fetchLyrics,
	fetchPlainLyricsText,
	fetchSyncedLyricsFallback,
	lyricsFromHit,
	parseLRC,
	parseMusixmatchRichSync,
	parseTTML,
	pickBestLyricsHit,
	pickItunesDuration,
	scoreLyricsHit,
	synthesizeWordTiming
} from '../src/lib/server/lyrics.js';

function fakePythonChild(stdout) {
	const proc = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.kill = () => proc.emit('close', null);
	queueMicrotask(() => {
		if (stdout != null) proc.stdout.emit('data', Buffer.from(stdout));
		proc.emit('close', 0);
	});
	return proc;
}

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
	assert.equal(lines.length, 2);
	assert.equal(lines[0].text, 'You can take it all');
	assert.equal(lines[0].time, 11.8);
});

test('parseLRC keeps a bare timestamp as a blank instrumental marker', () => {
	const lines = parseLRC('[00:12.00]You can take it all\n[00:16.00]\n[00:24.00]Just do not mess with me');
	assert.equal(lines.length, 3);
	assert.equal(lines[1].text, '');
	assert.equal(lines[1].time, 16);
	assert.equal(lines[1].words, undefined);
});

test('parseLRC reads enhanced word clocks', () => {
	const lines = parseLRC('[00:12.00]<00:12.00>You <00:12.40>can <00:12.80>take');
	assert.equal(lines[0].text, 'You can take');
	assert.equal(lines[0].words.length, 3);
	assert.equal(lines[0].words[1].text, 'can');
	assert.equal(lines[0].words[1].time, 12.4);
});

test('parseLRC synthesizes word timing for plain (line-only) LRC', () => {
	const lines = parseLRC('[00:10.00]You can take it all\n[00:14.00]Just do not mess with me');
	assert.equal(lines[0].words.length, 5);
	assert.equal(lines[0].words[0].text, 'You');
	assert.equal(lines[0].words[0].time, 10);
	// Words stay within the line's own span and strictly increase in time.
	for (const w of lines[0].words) {
		assert.ok(w.time >= 10 && w.time < 14);
	}
	for (let i = 1; i < lines[0].words.length; i++) {
		assert.ok(lines[0].words[i].time > lines[0].words[i - 1].time);
	}
});

test('synthesizeWordTiming skips single-word and blank lines', () => {
	const lines = synthesizeWordTiming([
		{ time: 0, text: 'Yeah' },
		{ time: 2, text: '' },
		{ time: 10, text: 'end' }
	]);
	assert.equal(lines[0].words, undefined);
	assert.equal(lines[1].words, undefined);
});

test('synthesizeWordTiming caps the span for an unusually long gap', () => {
	const lines = synthesizeWordTiming([
		{ time: 0, text: 'A very short line here' },
		{ time: 120, text: 'end' }
	]);
	const last = lines[0].words.at(-1);
	assert.ok(last.time < 8, 'should not stretch across the whole 120s gap');
});

test('synthesizeWordTiming gives longer words a bigger share of the span', () => {
	const lines = synthesizeWordTiming([
		{ time: 0, text: 'a extraordinarily' },
		{ time: 4, text: 'end' }
	]);
	const [a, extraordinarily] = lines[0].words;
	const aSpan = extraordinarily.time - a.time;
	const remaining = 4 - extraordinarily.time;
	assert.ok(remaining > aSpan, '"extraordinarily" should get more time than "a"');
});

test('synthesizeWordTiming leaves already-timed words alone', () => {
	const lines = synthesizeWordTiming([{ time: 0, text: 'You can', words: [{ time: 0, text: 'You' }, { time: 1, text: 'can' }] }]);
	assert.equal(lines[0].words[0].time, 0);
	assert.equal(lines[0].words[1].time, 1);
});

test('parseTTML reads Apple Music-style word spans', () => {
	const ttml = `<p begin="00:01.230" end="00:04.500">` +
		`<span begin="00:01.230" end="00:01.540">You</span> ` +
		`<span begin="00:01.600" end="00:01.900">can</span> ` +
		`<span begin="00:01.950" end="00:02.400">take</span></p>`;
	const lines = parseTTML(ttml);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].time, 1.23);
	assert.equal(lines[0].text, 'You can take');
	assert.equal(lines[0].words.length, 3);
	assert.equal(lines[0].words[1].text, 'can');
	assert.equal(lines[0].words[1].time, 1.6);
});

test('parseTTML handles HH:MM:SS.mmm and keeps a spanless <p> as an instrumental marker', () => {
	const ttml =
		'<p begin="00:00:12.000" end="00:00:14.000">Hello</p>' +
		'<p begin="00:00:20.000" end="00:00:26.000"></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines.length, 2);
	assert.equal(lines[0].time, 12);
	assert.equal(lines[0].text, 'Hello');
	assert.equal(lines[0].words, undefined);
	assert.equal(lines[1].time, 20);
	assert.equal(lines[1].text, '');
});

test('parseMusixmatchRichSync converts chunk offsets to absolute word times', () => {
	const body = [
		{
			ts: 12.0,
			te: 16.0,
			x: 'You can take it all',
			l: [
				{ c: 'You ', o: 0 },
				{ c: 'can ', o: 0.4 },
				{ c: 'take ', o: 0.8 },
				{ c: 'it ', o: 1.3 },
				{ c: 'all', o: 1.6 }
			]
		},
		{ ts: 20.0, te: 24.0, x: '', l: [] }
	];
	const lines = parseMusixmatchRichSync(body);
	assert.equal(lines.length, 2);
	assert.equal(lines[0].time, 12);
	assert.equal(lines[0].text, 'You can take it all');
	assert.equal(lines[0].words.length, 5);
	assert.equal(lines[0].words[2].text, 'take');
	assert.ok(Math.abs(lines[0].words[2].time - 12.8) < 1e-9);
	assert.equal(lines[1].text, '', 'an empty line stays a blank instrumental marker');
	assert.equal(lines[1].words, undefined);
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

test('fetchSyncedLyricsFallback parses LRC text the python helper prints', async () => {
	const calls = [];
	const lines = await fetchSyncedLyricsFallback('Some Artist', 'Some Song', {
		spawnFn: (bin, args) => {
			calls.push([bin, args]);
			return fakePythonChild(JSON.stringify({ synced: '[00:05.00]Hello there' }));
		}
	});
	assert.deepEqual(calls[0][1].slice(1), ['Some Artist', 'Some Song']);
	assert.equal(lines[0].text, 'Hello there');
	assert.equal(lines[0].time, 5);
});

test('fetchSyncedLyricsFallback resolves null when nothing matched', async () => {
	const lines = await fetchSyncedLyricsFallback('Nobody', 'Nothing', {
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: null }))
	});
	assert.equal(lines, null);
});

test('fetchSyncedLyricsFallback resolves null (not throw) on bad output or spawn failure', async () => {
	const badOutput = await fetchSyncedLyricsFallback('A', 'B', {
		spawnFn: () => fakePythonChild('not json')
	});
	assert.equal(badOutput, null);

	const spawnThrows = await fetchSyncedLyricsFallback('A', 'B', {
		spawnFn: () => {
			throw new Error('no python3');
		}
	});
	assert.equal(spawnThrows, null);
});

test('fetchLyrics falls back to syncedlyrics when LRCLIB has no hit', async () => {
	const load = async (url) => {
		if (url.includes('/api/get')) throw new Error('404');
		if (url.includes('/api/search')) return [];
		throw new Error('unexpected ' + url);
	};
	const lines = await fetchLyrics('Obscure Artist', 'Obscure Song', {
		duration: 200,
		load,
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: '[00:03.00]From syncedlyrics' }))
	});
	assert.equal(lines[0].text, 'From syncedlyrics');
});

test('fetchPlainLyricsText returns the plain lyric text LRCLIB served alongside a hit', async () => {
	const load = async (url) => {
		if (url.includes('/api/get')) {
			return {
				trackName: 'My Way',
				artistName: 'Frank Sinatra',
				duration: 275,
				plainLyrics: 'And now, the end is near\nAnd so I face the final curtain'
			};
		}
		throw new Error('unexpected ' + url);
	};
	const text = await fetchPlainLyricsText('Frank Sinatra', 'My Way', { duration: 275, load });
	assert.equal(text, 'And now, the end is near\nAnd so I face the final curtain');
});

test('fetchPlainLyricsText returns null when there is nothing to align against', async () => {
	const load = async (url) => {
		if (url.includes('/api/get')) throw new Error('404');
		if (url.includes('/api/search')) return [];
		throw new Error('unexpected ' + url);
	};
	const text = await fetchPlainLyricsText('Nobody', 'Nothing', {
		duration: 200,
		load,
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: null }))
	});
	assert.equal(text, null);
});
