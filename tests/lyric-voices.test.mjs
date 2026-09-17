import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTTML } from '../src/lib/server/lyrics.js';
import { annotateLyricVoices, isLyricReply } from '../src/lib/lyricVoices.js';
import { isLineSinging } from '../src/lib/playbackClock.js';
import { VOICE_DEMO_LINES } from '../src/lib/lyricVoicesDemo.js';

test('parseTTML keeps x-bg chorus parts off the lead karaoke line', () => {
	const ttml =
		'<p begin="00:01.000" end="00:04.000" ttm:agent="v1">' +
		'<span begin="00:01.000" end="00:01.400">Original</span> ' +
		'<span begin="00:01.400" end="00:02.000">yeah</span>' +
		'<span ttm:role="x-bg">' +
		'<span begin="00:02.200" end="00:02.800">echo</span>' +
		'</span></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].text, 'Original yeah');
	assert.equal(lines[0].words.length, 2);
	assert.equal(lines[0].background.length, 1);
	assert.equal(lines[0].background[0].text, 'echo');
	assert.equal(lines[0].background[0].words[0].time, 2.2);
	assert.equal(lines[0].agent, 'v1');
});

test('parseTTML staggers overlapping agents as a back-and-forth', () => {
	const ttml =
		'<p begin="00:01.000" end="00:04.000" ttm:agent="v1">' +
		'<span begin="00:01.000" end="00:02.200">Call it out</span></p>' +
		'<p begin="00:01.600" end="00:03.800" ttm:agent="v2">' +
		'<span begin="00:01.600" end="00:02.800">Send it back</span></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines.length, 2);
	assert.equal(lines[0].side, 'left');
	assert.equal(lines[0].part, 'lead');
	assert.equal(lines[1].side, 'right');
	assert.equal(lines[1].part, 'reply');
	assert.equal(isLyricReply(lines[1]), true);
	assert.equal(isLineSinging(lines[0], 1.8, lines[1].time), true);
	assert.equal(isLineSinging(lines[1], 1.8, undefined), true);
});

test('annotateLyricVoices tucks a parenthetical chorus under the lead', () => {
	const lines = annotateLyricVoices([
		{
			time: 10,
			end: 14,
			text: 'Keep the line',
			words: [
				{ time: 10, text: 'Keep', end: 11 },
				{ time: 11, text: 'the', end: 12 },
				{ time: 12, text: 'line', end: 14 }
			]
		},
		{ time: 12.4, end: 13.2, text: '(now)', words: [{ time: 12.4, text: '(now)', end: 13.2 }] },
		{ time: 16, text: 'Next verse starts' }
	]);
	assert.equal(lines.length, 2);
	assert.equal(lines[0].text, 'Keep the line');
	assert.equal(lines[0].background[0].text, '(now)');
	assert.equal(lines[1].text, 'Next verse starts');
});

test('voice demo staggers a reply and tucks a chorus echo under the lead', () => {
	assert.equal(VOICE_DEMO_LINES.length, 3);
	assert.equal(VOICE_DEMO_LINES[0].part, 'lead');
	assert.equal(VOICE_DEMO_LINES[1].part, 'reply');
	assert.equal(VOICE_DEMO_LINES[1].side, 'right');
	assert.equal(VOICE_DEMO_LINES[2].background[0].text, 'now');
	assert.equal(VOICE_DEMO_LINES[2].background[1].text, 'hold it');
});

test('parseTTML splits a top-level br into a smaller row under the lead', () => {
	const ttml =
		'<p begin="00:01.000" end="00:05.000">' +
		'<span begin="00:01.000" end="00:01.500">Hold</span> ' +
		'<span begin="00:01.500" end="00:02.200">the line</span><br/>' +
		'<span begin="00:02.400" end="00:02.800">Keep</span> ' +
		'<span begin="00:02.800" end="00:03.200">it</span> ' +
		'<span begin="00:03.200" end="00:04.200">going</span></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].text, 'Hold the line');
	assert.equal(lines[0].words.map((w) => w.text).join(' '), 'Hold the line');
	assert.equal(lines[0].background.length, 1);
	assert.equal(lines[0].background[0].text, 'Keep it going');
	assert.equal(lines[0].background[0].words[0].time, 2.4);
	assert.equal(lines[0].background[0].words.at(-1).text, 'going');
});

test('parseTTML treats a spaced br tag the same as a self-closing one', () => {
	const ttml =
		'<p begin="00:01.000" end="00:03.000">' +
		'<span begin="00:01.000" end="00:01.500">Keep</span><br />' +
		'<span begin="00:01.700" end="00:02.200">going</span></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines[0].text, 'Keep');
	assert.equal(lines[0].background[0].text, 'going');
});

test('parseTTML splits a spanless br into lead plus under-line text', () => {
	const lines = parseTTML('<p begin="00:01.000" end="00:03.000">Hello<br/>there</p>');
	assert.equal(lines.length, 1);
	assert.equal(lines[0].text, 'Hello');
	assert.equal(lines[0].background.length, 1);
	assert.equal(lines[0].background[0].text, 'there');
	assert.equal(lines[0].words, undefined);
});

test('parseTTML does not duplicate an x-bg row that already follows a br', () => {
	const ttml =
		'<p begin="00:01.000" end="00:04.000">' +
		'<span begin="00:01.000" end="00:02.000">Lead</span><br/>' +
		'<span ttm:role="x-bg">' +
		'<span begin="00:02.200" end="00:03.000">echo</span>' +
		'</span></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines[0].text, 'Lead');
	assert.equal(lines[0].background.length, 1);
	assert.equal(lines[0].background[0].text, 'echo');
	assert.equal(lines[0].background[0].words[0].time, 2.2);
});

test('parseTTML ignores a br nested inside a timed span', () => {
	const ttml =
		'<p begin="00:01.000" end="00:03.000">' +
		'<span begin="00:01.000" end="00:01.600">one<br/>word</span> ' +
		'<span begin="00:01.600" end="00:02.200">next</span></p>';
	const lines = parseTTML(ttml);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].text, 'one word next');
	assert.equal(lines[0].background, undefined);
	assert.equal(lines[0].words.length, 2);
	assert.equal(lines[0].words[0].text, 'one word');
	assert.equal(lines[0].words[1].text, 'next');
});
