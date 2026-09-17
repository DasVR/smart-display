import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventEmitter } from 'node:events';

import {
	ensureLyricsCached,
	ensureTrackDurationCached,
	fetchLyrics,
	fetchPlainLyricsText,
	fetchSyncedLyricsFallback,
	hasRealWordTiming,
	linesFromCommunityPayload,
	lyricsFromHit,
	dropNonLyricLines,
	parseKrc,
	parseLRC,
	parseMusixmatchRichSync,
	parseTTML,
	parseYrc,
	peekLyrics,
	peekTrackDuration,
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

test('fetchLyrics prefers syncedlyrics over LRCLIB and never touches LRCLIB on a syncedlyrics hit', async () => {
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

test('dropNonLyricLines strips a title header even when it starts after 3s', () => {
	const lines = dropNonLyricLines(
		[
			{ time: 8, text: 'Numb (英雄联盟代表音乐)' },
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

test('dropNonLyricLines turns em-dash rest cues into instrumental markers', () => {
	const lines = dropNonLyricLines([
		{ time: 10, text: 'verse one' },
		{ time: 14, text: '—' },
		{ time: 16, text: '---' },
		{ time: 18, text: '♪ ♪' },
		{ time: 20, text: 'verse two' }
	]);
	assert.equal(lines[1].text, '');
	assert.equal(lines[1].instrumental, true);
	assert.equal(lines[2].text, '');
	assert.equal(lines[3].text, '');
	assert.equal(lines[4].text, 'verse two');
});

test('parseLRC treats a dash-only timed line as a blank rest marker', () => {
	const lines = parseLRC('[00:12.00]You can take it all\n[00:16.00]—\n[00:24.00]Just do not mess with me');
	assert.equal(lines[1].text, '');
	assert.equal(lines[1].instrumental, true);
	assert.equal(lines[1].words, undefined);
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
