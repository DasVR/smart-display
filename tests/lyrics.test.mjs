import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep the persistent cache out of the repo's data/ dir while testing.
process.env.LYRICS_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), 'lyrics-db-')), 'lyrics.db');

import {
	ensureLyricsCached,
	ensureTrackDurationCached,
	fetchLyrics,
	fetchPlainLyricsText,
	fetchSyncedLyricsFallback,
	hasRealWordTiming,
	linesFromCommunityPayload,
	lyricsCacheKey,
	lyricsFromHit,
	dropNonLyricLines,
	parseKrc,
	parseLRC,
	parseMusixmatchRichSync,
	parseTTML,
	parseYrc,
	peekLyrics,
	peekLyricsInfo,
	peekTrackDuration,
	pickBestLyricsHit,
	pickItunesDuration,
	scoreLyricsHit,
	tidyInstrumentalMarkers,
	synthesizeWordTiming
} from '../src/lib/server/lyrics.js';
import { getLyricsRow, lyricsDbStats } from '../src/lib/server/lyricsStore.js';

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

test('synthesizeWordTiming weighs words by syllable count, not raw length', () => {
	// "screamed" is 8 characters but one syllable; "melody" is shorter but
	// three syllables - a speech-accurate estimate should give melody more
	// time despite being the shorter word, which a character-count weight
	// would get backwards.
	const lines = synthesizeWordTiming([
		{ time: 0, text: 'screamed melody' },
		{ time: 4, text: 'end' }
	]);
	const [screamed, melody] = lines[0].words;
	const screamedSpan = melody.time - screamed.time;
	const melodySpan = 4 - melody.time;
	assert.ok(melodySpan > screamedSpan, '"melody" (3 syllables) should get more time than "screamed" (1)');
});

test('synthesizeWordTiming gives a clause-ending word a small trailing pause', () => {
	const withComma = synthesizeWordTiming([
		{ time: 0, text: 'wait, go' },
		{ time: 4, text: 'end' }
	]);
	const withoutComma = synthesizeWordTiming([
		{ time: 0, text: 'wait go' },
		{ time: 4, text: 'end' }
	]);
	const commaGoStart = withComma[0].words[1].time;
	const plainGoStart = withoutComma[0].words[1].time;
	assert.ok(commaGoStart > plainGoStart, 'a comma after "wait" should push the next word out a bit further');
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
	assert.equal(lines[0].words[1].end, 1.9);
	assert.equal(lines[0].end, 4.5);
});

test('parseTTML glues contraction fragments instead of painting don \' t', () => {
	const ttml = `<p begin="00:01.000" end="00:02.000">` +
		`<span begin="00:01.000" end="00:01.200">They</span> ` +
		`<span begin="00:01.220" end="00:01.400">don</span>` +
		`<span begin="00:01.400" end="00:01.480">'</span>` +
		`<span begin="00:01.480" end="00:01.700">t</span></p>`;
	const lines = parseTTML(ttml);
	assert.equal(lines[0].text, "They don't");
	assert.equal(lines[0].words.length, 2);
	assert.equal(lines[0].words[0].text, 'They');
	assert.equal(lines[0].words[1].text, "don't");
});

test('parseTTML glues a contraction even when the source put spaces around the apostrophe', () => {
	const ttml = `<p begin="00:01.000" end="00:02.000">` +
		`<span begin="00:01.000" end="00:01.200">don</span> ` +
		`<span begin="00:01.200" end="00:01.280">'</span> ` +
		`<span begin="00:01.280" end="00:01.500">t</span></p>`;
	const lines = parseTTML(ttml);
	assert.equal(lines[0].text, "don't");
	assert.equal(lines[0].words.length, 1);
	assert.equal(lines[0].words[0].text, "don't");
});

test('parseYrc glues a split apostrophe into one word', () => {
	const lines = parseYrc("[1000,800](1000,200,0)don(1200,80,0)'(1280,120,0)t");
	assert.equal(lines[0].text, "don't");
	assert.equal(lines[0].words.length, 1);
	assert.equal(lines[0].words[0].text, "don't");
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

test('fetchLyrics asks LRCLIB /api/get with duration once syncedlyrics has nothing', async () => {
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
		load,
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: null }))
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
	assert.equal(calls[0][1][1], 'Some Artist');
	assert.equal(calls[0][1][2], 'Some Song');
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

test('fetchLyrics prefers syncedlyrics over LRCLIB even when LRCLIB is down', async () => {
	const load = async (url) => {
		throw new Error('LRCLIB should not have been called: ' + url);
	};
	const lines = await fetchLyrics('Some Artist', 'Some Song', {
		duration: 200,
		load,
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: '[00:03.00]From syncedlyrics' }))
	});
	assert.equal(lines[0].text, 'From syncedlyrics');
});

test('fetchLyrics falls back to LRCLIB when syncedlyrics has nothing', async () => {
	const load = async (url) => {
		if (url.includes('/api/get')) throw new Error('404');
		if (url.includes('/api/search')) return [];
		throw new Error('unexpected ' + url);
	};
	const lines = await fetchLyrics('Obscure Artist', 'Obscure Song', {
		duration: 200,
		load,
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: null }))
	});
	assert.equal(lines, null);
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
	const text = await fetchPlainLyricsText('Frank Sinatra', 'My Way', {
		duration: 275,
		load,
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: null }))
	});
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

test('peekLyrics/ensureLyricsCached never block the caller on a cold cache', async () => {
	const artist = `Peek Artist ${Date.now()}`;
	const title = 'Peek Song';
	const before = peekLyrics(artist, title, '', 210);
	assert.deepEqual(before, { known: false, lines: null });

	let resolveLoad;
	const load = (url) => {
		if (url.includes('/api/get')) {
			return new Promise((resolve) => {
				resolveLoad = () =>
				resolve({ trackName: title, artistName: artist, duration: 210, syncedLyrics: '[00:01.00]hi' });
			});
		}
		return Promise.reject(new Error('unexpected ' + url));
	};
	// Fires the lookup in the background - must return immediately either way.
	ensureLyricsCached(artist, title, {
		duration: 210,
		load,
		spawnFn: () => fakePythonChild(JSON.stringify({ synced: null }))
	});
	assert.deepEqual(peekLyrics(artist, title, '', 210), { known: false, lines: null });

	// Let the syncedlyrics tier's fake subprocess resolve (nothing found)
	// before LRCLIB's `load` gets called.
	await new Promise((resolve) => setImmediate(resolve));
	resolveLoad();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(peekLyrics(artist, title, '', 210).known, true);
});

test('peekTrackDuration/ensureTrackDurationCached never block the caller on a cold cache', async () => {
	const artist = `Duration Artist ${Date.now()}`;
	const title = 'Duration Song';
	assert.equal(peekTrackDuration(artist, title), undefined);

	let resolveLoad;
	const load = () =>
		new Promise((resolve) => {
			resolveLoad = () =>
				resolve({ results: [{ trackName: title, artistName: artist, trackTimeMillis: 200000 }] });
		});
	ensureTrackDurationCached(artist, title, { load });
	assert.equal(peekTrackDuration(artist, title), undefined);

	resolveLoad();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(peekTrackDuration(artist, title), 200);
});

test('parseYrc reads karaoke word clocks from LRC-style and JSON rows', () => {
	const lines = parseYrc(
		'[48100,3780](48100,300,0)Caught (48400,60,0)in (48460,210,0)the (48670,630,0)undertow\n' +
			'{"t":1000,"c":[{"tx":"Hello","t":0},{"tx":"there","t":400}]}'
	);
	const karaoke = lines.find((line) => line.text.includes('Caught'));
	const credit = lines.find((line) => line.text === 'Hello there');
	assert.equal(karaoke.words[0].text, 'Caught');
	assert.equal(karaoke.words[1].time, 48.4);
	assert.equal(karaoke.words[0].end, 48.4);
	assert.equal(credit.words[1].time, 1.4);
});

test('parseYrc drops 作词/作曲 credit rows', () => {
	const lines = parseYrc(
		'{"t":0,"c":[{"tx":"作词: "},{"tx":"Mike Shinoda"}]}\n' +
			'[48100,3780](48100,300,0)Caught (48400,60,0)in (48460,210,0)the'
	);
	assert.equal(lines.some((line) => /作词/.test(line.text)), false);
	assert.equal(lines[0].text.includes('Caught'), true);
});

test('dropNonLyricLines strips a Kugou title-artist header and keeps the verse', () => {
	const lines = dropNonLyricLines(
		parseKrc(
			'[100,100]<0,100,0>Numb (英雄联盟代表音乐) - Linkin Park\n' +
				'[25872,4298]<0,475,0>Feeling <475,242,0>so <717,1315,0>faithless'
		),
		{ artist: 'Linkin Park', title: 'Numb' }
	);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].text, 'Feeling so faithless');
	assert.ok(Math.abs(lines[0].words[1].end - (25.872 + 0.475 + 0.242)) < 1e-9);
});

test('dropNonLyricLines strips end credits without eating a verse that starts The end', () => {
	const lines = dropNonLyricLines([
		{ time: 10, text: 'a real verse' },
		{ time: 12, text: 'The end is near' },
		{ time: 200, text: 'Thanks for listening' },
		{ time: 201, text: 'The end' },
		{ time: 202, text: 'LRC by some user' },
		{ time: 203, text: '© 2024 NetEase' }
	]);
	assert.deepEqual(
		lines.map((line) => line.text),
		['a real verse', 'The end is near']
	);
});

test('dropNonLyricLines keeps a later chorus that repeats the title', () => {
	const lines = dropNonLyricLines(
		[
			{ time: 0.1, text: 'Numb - Linkin Park' },
			{ time: 22, text: "I'm tired of being what you want me to be" },
			{ time: 80, text: 'Numb' }
		],
		{ artist: 'Linkin Park', title: 'Numb' }
	);
	assert.deepEqual(
		lines.map((line) => line.text),
		["I'm tired of being what you want me to be", 'Numb']
	);
});

test('parseKrc converts word offsets into absolute times', () => {
	const lines = parseKrc('[25872,4298]<0,475,0>Feeling <475,242,0>so <717,1315,0>faithless');
	assert.equal(lines[0].text, 'Feeling so faithless');
	assert.equal(lines[0].words[1].text, 'so');
	assert.ok(Math.abs(lines[0].words[1].time - (25.872 + 0.475)) < 1e-9);
});

test('hasRealWordTiming distinguishes estimated LRC from karaoke sources', () => {
	const estimated = parseLRC('[00:10.00]You can take it all\n[00:14.00]Just do not mess with me');
	assert.equal(hasRealWordTiming(estimated), false);
	const enhanced = parseLRC('[00:12.00]<00:12.00>You <00:12.40>can <00:12.80>take');
	assert.equal(hasRealWordTiming(enhanced), true);
	const yrc = parseYrc('[48100,3780](48100,300,0)Caught (48400,60,0)in (48460,210,0)the');
	assert.equal(hasRealWordTiming(yrc), true);
});

test('parseTTML skips translation spans without begin clocks', () => {
	const ttml =
		'<p begin="00:01.000">' +
		'<span begin="00:01.000">Hello</span> ' +
		'<span begin="00:01.400">there</span>' +
		'<span ttm:role="x-translation" xml:lang="zh-CN">你好</span></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines[0].words.length, 2);
	assert.equal(lines[0].text, 'Hello there');
});

test('linesFromCommunityPayload prefers canonical word-level lines', () => {
	const lines = linesFromCommunityPayload({
		wordLevel: true,
		lines: [{ time: 1, text: 'Hello there', words: [{ time: 1, text: 'Hello' }, { time: 1.4, text: 'there' }] }]
	});
	assert.equal(hasRealWordTiming(lines), true);
	assert.equal(lines[0].words[1].time, 1.4);
});

test('fetchSyncedLyricsFallback accepts a word-level community payload', async () => {
	const lines = await fetchSyncedLyricsFallback('Linkin Park', 'Numb', {
		spawnFn: () =>
			fakePythonChild(
				JSON.stringify({
					source: 'amll-ttml',
					wordLevel: true,
					ttml:
						'<p begin="00:22.065"><span begin="00:22.065">I\'m</span> <span begin="00:22.154">tired</span></p>'
				})
			)
	});
	assert.equal(lines[0].words[0].text, "I'm");
	assert.equal(hasRealWordTiming(lines), true);
});

test('fetchLyrics persists a hit to the SQLite store with its source and word-level flag', async () => {
	const artist = `Persist Artist ${Date.now()}`;
	const title = 'Persist Song';
	const lines = await fetchLyrics(artist, title, {
		duration: 200,
		spawnFn: () =>
			fakePythonChild(
				JSON.stringify({
					source: 'netease-yrc',
					wordLevel: true,
					lines: [
						{ time: 1, text: 'Hello there', words: [{ time: 1, text: 'Hello' }, { time: 1.4, text: 'there' }] },
						{ time: 3, text: 'friend of mine', words: [{ time: 3, text: 'friend' }, { time: 3.3, text: 'of' }, { time: 3.5, text: 'mine' }] }
					]
				})
			)
	});
	assert.equal(lines.length, 2);
	const row = getLyricsRow(lyricsCacheKey(artist, title, '', 200));
	assert.ok(row, 'hit should be written to the store');
	assert.equal(row.source, 'netease-yrc');
	assert.equal(row.wordLevel, true);
	assert.equal(row.artist, artist);
	assert.equal(row.duration, 200);
	assert.equal(row.lines[1].words[2].text, 'mine');
	assert.equal(row.plainText, 'Hello there\nfriend of mine');
	// A karaoke-grade hit is kept far longer than the old 6h memory TTL.
	assert.ok(row.ttl >= 300 * 24 * 60 * 60 * 1000);
	const info = peekLyricsInfo(artist, title, '', 200);
	assert.equal(info.known, true);
	assert.equal(info.source, 'netease-yrc');
	assert.equal(info.wordLevel, true);
	assert.equal(info.plainText, 'Hello there\nfriend of mine');
});

test('fetchLyrics keeps Genius canonical text while community karaoke stays the timed file', async () => {
	const artist = `Canon Artist ${Date.now()}`;
	const title = 'Canon Song';
	const lines = await fetchLyrics(artist, title, {
		duration: 200,
		load: async () => {
			throw new Error('LRCLIB should not run on a community hit');
		},
		spawnFn: (_bin, args) => {
			const script = String(args[0] || '');
			if (script.includes('canonical_lyrics.py')) {
				return fakePythonChild(
					JSON.stringify({
						plain: 'I walk a lonely road\nThe only one that I have ever known',
						source: 'genius',
						artist,
						title
					})
				);
			}
			return fakePythonChild(
				JSON.stringify({
					source: 'amll-ttml',
					wordLevel: true,
					lines: [
						{
							time: 8,
							text: 'i walk a',
							words: [
								{ time: 8, text: 'i' },
								{ time: 8.2, text: 'walk' },
								{ time: 8.4, text: 'a' }
							]
						}
					]
				})
			);
		}
	});
	assert.equal(lines[0].text, 'i walk a');
	const info = peekLyricsInfo(artist, title, '', 200);
	assert.equal(info.source, 'amll-ttml');
	assert.equal(info.plainSource, 'genius');
	assert.equal(info.plainText, 'I walk a lonely road\nThe only one that I have ever known');
});

test('fetchLyrics tags an LRCLIB line-synced hit and keeps it for a shorter retry window', async () => {
	const artist = `Lrclib Artist ${Date.now()}`;
	const title = 'Lrclib Song';
	const load = async (url) => {
		if (url.includes('/api/get')) {
			return { trackName: title, artistName: artist, duration: 180, syncedLyrics: '[00:10.00]Line one here\n[00:14.00]Line two here' };
		}
		throw new Error('unexpected ' + url);
	};
	await fetchLyrics(artist, title, { duration: 180, load, spawnFn: () => fakePythonChild(JSON.stringify({ synced: null })) });
	const row = getLyricsRow(lyricsCacheKey(artist, title, '', 180));
	assert.ok(row);
	assert.equal(row.source, 'lrclib-synced');
	assert.equal(row.wordLevel, false, 'synthesized word timing is not word-level');
	assert.ok(row.ttl < 300 * 24 * 60 * 60 * 1000);
	assert.ok(row.ttl >= 24 * 60 * 60 * 1000);
	const stats = lyricsDbStats();
	assert.equal(stats.available, true);
	assert.ok(stats.lyrics >= 2);
});

test('fetchLyrics does not persist a miss', async () => {
	const artist = `Miss Artist ${Date.now()}`;
	const title = 'Miss Song';
	const load = async () => [];
	const lines = await fetchLyrics(artist, title, { duration: 180, load, spawnFn: () => fakePythonChild(JSON.stringify({ synced: null })) });
	assert.equal(lines, null);
	assert.equal(peekLyrics(artist, title, '', 180).known, true, 'miss is remembered in memory');
	assert.equal(getLyricsRow(lyricsCacheKey(artist, title, '', 180)), null, 'but never written to disk');
});

function slowPythonChild(stdout, release) {
	const proc = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.kill = () => proc.emit('close', null);
	release.push(() => {
		proc.stdout.emit('data', Buffer.from(stdout));
		proc.emit('close', 0);
	});
	return proc;
}

test('LRCLIB lines show while the karaoke lookup is still running, then the karaoke file replaces them', async () => {
	const artist = `Fast Artist ${Date.now()}`;
	const title = 'Fast Song';
	const release = [];
	const load = async (url) => {
		if (url.includes('/api/get')) {
			return { trackName: title, artistName: artist, duration: 200, syncedLyrics: '[00:05.00]Line from lrclib\n[00:09.00]Second line' };
		}
		throw new Error('unexpected ' + url);
	};
	const done = fetchLyrics(artist, title, {
		duration: 200,
		load,
		spawnFn: (bin, args) =>
			args[0].endsWith('canonical_lyrics.py')
				? fakePythonChild(JSON.stringify({ plain: null }))
				: slowPythonChild(
						JSON.stringify({
							source: 'amll-ttml',
							wordLevel: true,
							lines: [
								{ time: 5, text: 'Line from karaoke', words: [{ time: 5, text: 'Line', end: 5.3 }, { time: 5.3, text: 'from', end: 5.6 }, { time: 5.6, text: 'karaoke', end: 6 }] }
							]
						}),
						release
					)
	});
	await new Promise((resolve) => setTimeout(resolve, 10));
	const early = peekLyricsInfo(artist, title, '', 200);
	assert.equal(early.known, true, 'lrclib is on screen before the karaoke lookup returns');
	assert.equal(early.provisional, true);
	assert.equal(early.lines[0].text, 'Line from lrclib');
	assert.equal(getLyricsRow(lyricsCacheKey(artist, title, '', 200)), null, 'provisional lines are memory only');
	release.forEach((fn) => fn());
	await done;
	const final = peekLyricsInfo(artist, title, '', 200);
	assert.equal(final.provisional, false);
	assert.equal(final.source, 'amll-ttml');
	assert.equal(final.lines[0].text, 'Line from karaoke');
});

test('a karaoke file from another release is shifted onto the exact-duration LRCLIB stamps', async () => {
	const artist = `Offset Artist ${Date.now()}`;
	const title = 'Offset Song';
	const texts = ['alpha one', 'bravo two', 'charlie three', 'delta four', 'echo five'];
	const lrc = texts.map((t, i) => `[00:${String(10 + i * 5).padStart(2, '0')}.00]${t}`).join('\n');
	const load = async (url) => {
		if (url.includes('/api/get')) return { trackName: title, artistName: artist, duration: 200, syncedLyrics: lrc };
		throw new Error('unexpected ' + url);
	};
	const karaoke = texts.map((t, i) => {
		const start = 14 + i * 5;
		const [a, b] = t.split(' ');
		return { time: start, text: t, words: [{ time: start, text: a, end: start + 0.4 }, { time: start + 0.4, text: b, end: start + 0.8 }] };
	});
	const lines = await fetchLyrics(artist, title, {
		duration: 200,
		load,
		spawnFn: (bin, args) =>
			fakePythonChild(
				args[0].endsWith('canonical_lyrics.py')
					? JSON.stringify({ plain: null })
					: JSON.stringify({ source: 'netease-yrc', wordLevel: true, lines: karaoke })
			)
	});
	assert.equal(lines[0].time, 10);
	assert.ok(Math.abs(lines[0].words[1].time - 10.4) < 1e-9);
});

test('fetchLyrics restores masked profanity from the canonical sheet', async () => {
	const artist = `Masked Artist ${Date.now()}`;
	const title = 'Masked Song';
	const lines = await fetchLyrics(artist, title, {
		duration: 200,
		load: async () => {
			throw new Error('offline');
		},
		spawnFn: (bin, args) =>
			fakePythonChild(
				args[0].endsWith('canonical_lyrics.py')
					? JSON.stringify({ plain: 'I said fuck you\nThis shit is real', source: 'genius' })
					: JSON.stringify({ synced: '[00:05.00]I said **** you\n[00:09.00]This sh*t is real' })
			)
	});
	assert.deepEqual(
		lines.map((l) => l.text),
		['I said fuck you', 'This shit is real']
	);
	assert.ok(lines[0].words.every((w) => !w.text.includes('*')));
});

test('parseYrc keeps masked swears as their own word and restores them downstream', () => {
	const lines = parseYrc('[1000,900](1000,100,0)Tear (1100,100,0)this (1200,50,0)*(1250,50,0)*(1300,50,0)*(1350,100,0)in (1450,100,0)roof');
	assert.deepEqual(
		lines[0].words.map((w) => w.text),
		['Tear', 'this', '***in', 'roof']
	);
});

test('tidyInstrumentalMarkers collapses blank runs and drops blanks that are only a breath', () => {
	const lines = [
		{ time: 1, text: 'sung' },
		{ time: 4, text: '' },
		{ time: 5, text: '' },
		{ time: 20, text: 'next verse' },
		{ time: 22, text: '' },
		{ time: 23, text: 'right after' },
		{ time: 30, text: '' }
	];
	assert.deepEqual(
		tidyInstrumentalMarkers(lines).map((l) => [l.time, l.text]),
		[
			[1, 'sung'],
			[4, ''],
			[20, 'next verse'],
			[23, 'right after'],
			[30, '']
		]
	);
});

test('synthesized words sweep at singing pace before a long instrumental, not across it', () => {
	const [line] = synthesizeWordTiming([
		{ time: 10, text: 'I walk a lonely road' },
		{ time: 40, text: 'next verse' }
	]);
	const last = line.words[line.words.length - 1];
	assert.ok(last.end < 14, `the line should finish in a few seconds, not ${last.end - 10}s`);
	const [tight] = synthesizeWordTiming([
		{ time: 10, text: 'I walk a lonely road' },
		{ time: 12.5, text: 'next line' }
	]);
	assert.equal(tight.words[tight.words.length - 1].end, 12.5, 'back-to-back lines still fill the gap');
});
