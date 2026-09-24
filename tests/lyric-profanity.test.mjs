import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	isMaskedToken,
	uncensorLines,
	uncensorPlain,
	uncensorText,
	uncensorToken
} from '../src/lib/lyricProfanity.js';

test('uncensorToken restores common masks and keeps case and punctuation', () => {
	assert.equal(uncensorToken('f**k'), 'fuck');
	assert.equal(uncensorToken('F*ck,'), 'Fuck,');
	assert.equal(uncensorToken('SH*T!'), 'SHIT!');
	assert.equal(uncensorToken('b**ch'), 'bitch');
	assert.equal(uncensorToken('ni**a'), 'nigga');
	assert.equal(uncensorToken("f***in'"), "fuckin'");
	assert.equal(uncensorToken('motherf***er'), 'motherfucker');
	assert.equal(uncensorToken('f--k'), 'fuck');
	assert.equal(uncensorToken('d**n'), 'damn');
});

test('a star count that does not match picks the closest-length word', () => {
	// NetEase writes "motherfuckin'" as nine stars plus "in".
	assert.equal(uncensorToken('*********in'), 'motherfuckin');
});

test('a masked piece glued to another word by an apostrophe is fixed alone', () => {
	assert.equal(uncensorToken("f**k'bout"), "fuck'bout");
});

test('unmasked words and look-alikes are left alone', () => {
	assert.equal(uncensorToken('shit'), 'shit');
	assert.equal(uncensorText('love—hate and hello*world'), 'love—hate and hello*world');
	assert.equal(uncensorToken('****'), '****', 'a fully masked word needs the lyric sheet');
	assert.equal(isMaskedToken('don\'t'), false);
	assert.equal(isMaskedToken('f**k'), true);
});

test('the lyric sheet fills fully masked words and wins on spelling', () => {
	const sheet = 'I said fuck you\nNiggaz in Paris';
	assert.equal(uncensorLines([{ time: 1, text: 'I said **** you' }], sheet)[0].text, 'I said fuck you');
	assert.equal(uncensorLines([{ time: 2, text: 'N***az in Paris' }], sheet)[0].text, 'Niggaz in Paris');
});

test('timed words, background rows and text are all restored', () => {
	const [line] = uncensorLines(
		[
			{
				time: 1,
				text: '**** you',
				words: [
					{ time: 1, text: '****', end: 1.3 },
					{ time: 1.3, text: 'you', end: 1.6 }
				],
				background: [{ time: 2, text: '(sh*t)' }]
			}
		],
		'fuck you'
	);
	assert.equal(line.text, 'fuck you');
	assert.equal(line.words[0].text, 'fuck');
	assert.equal(line.words[0].end, 1.3, 'clocks untouched');
	assert.equal(line.background[0].text, '(shit)');
});

test('uncensorLines returns the same array when nothing is masked', () => {
	const lines = [{ time: 1, text: 'clean line' }];
	assert.equal(uncensorLines(lines), lines);
});

test('uncensorPlain restores a whole sheet line by line', () => {
	assert.equal(uncensorPlain('sh*t\nclean\nb***h'), 'shit\nclean\nbitch');
});
