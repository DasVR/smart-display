import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../scripts/airplay-metadata.py'
);

function b64(text) {
	return Buffer.from(text, 'utf8').toString('base64');
}

function item(typeHex, codeHex, text) {
	const data = text == null ? '' : `<data encoding="base64">${b64(text)}</data>`;
	return `<item><type>${typeHex}</type><code>${codeHex}</code><length>${text ? Buffer.byteLength(text) : 0}</length>${data}</item>`;
}

function parse(xml) {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'airplay-meta-'));
	const raw = execFileSync('python3', [script, '--parse-stdin'], {
		input: xml,
		encoding: 'utf8',
		env: {
			...process.env,
			AIRPLAY_NOWPLAYING_PATH: path.join(dir, 'now.json'),
			AIRPLAY_ART_PATH: path.join(dir, 'art.jpg')
		}
	});
	return JSON.parse(raw);
}

test('airplay metadata parser reads Apple Music tags from the shairport pipe format', () => {
	const xml =
		item('73736e63', '70626567') +
		item('636f7265', '6d696e6d', 'Daylight') +
		item('636f7265', '61736172', 'Taylor Swift') +
		item('636f7265', '6173616c', 'Lover');
	const state = parse(xml);
	assert.equal(state.playing, true);
	assert.equal(state.title, 'Daylight');
	assert.equal(state.artist, 'Taylor Swift');
	assert.equal(state.album, 'Lover');
	assert.equal(state.source, 'airplay');
});

test('airplay metadata parser clears playing on session end', () => {
	const xml = item('73736e63', '70626567') + item('73736e63', '70656e64');
	assert.equal(parse(xml).playing, false);
});

test('airplay metadata parser keeps a titled pause through stream end', () => {
	const xml =
		item('636f7265', '6d696e6d', 'Daylight') +
		item('73736e63', '70726772', '0/441000/12039300') +
		item('73736e63', '70656e64');
	const state = parse(xml);
	assert.equal(state.playing, false);
	assert.equal(state.paused, true);
	assert.equal(state.title, 'Daylight');
	assert.ok(state.position >= 10 && state.position < 11);
	assert.equal(state.seeking, false);
});

test('airplay metadata parser wipes an untitled stream end', () => {
	const xml = item('73736e63', '70626567') + item('73736e63', '70656e64');
	const state = parse(xml);
	assert.equal(state.playing, false);
	assert.equal(state.paused, false);
	assert.equal(state.title, '');
});

test('airplay metadata parser keeps a paused session through a heartbeat', () => {
	const xml =
		item('636f7265', '6d696e6d', 'My Way') +
		item('73736e63', '63617073', String.fromCharCode(3)) +
		item('73736e63', '70686274');
	const state = parse(xml);
	assert.equal(state.playing, false);
	assert.equal(state.paused, true);
	assert.equal(state.title, 'My Way');
});

test('airplay metadata parser keeps the session through a flush', () => {
	const xml = item('73736e63', '70626567') + item('73736e63', '70666c73');
	const state = parse(xml);
	assert.equal(state.playing, true);
});

test('airplay metadata parser marks seeking on a flush and clears it on the next progress report', () => {
	const midFlush =
		item('636f7265', '6d696e6d', 'My Way') +
		item('73736e63', '70726772', '0/441000/12039300') +
		item('73736e63', '70666c73');
	assert.equal(parse(midFlush).seeking, true);

	const afterSeek =
		item('636f7265', '6d696e6d', 'My Way') +
		item('73736e63', '70726772', '0/441000/12039300') +
		item('73736e63', '70666c73') +
		item('73736e63', '70726772', '0/8820000/12039300');
	assert.equal(parse(afterSeek).seeking, false);
});

test('airplay metadata parser reads duration and progress', () => {
	const xml =
		item('636f7265', '6d696e6d', 'My Way') +
		item('636f7265', '61736172', 'Limp Bizkit') +
		item('636f7265', '6173746d', '273000') +
		item('73736e63', '70726772', '0/441000/12039300');
	const state = parse(xml);
	assert.equal(state.title, 'My Way');
	assert.equal(state.length, 273);
	assert.equal(state.position, 10);
	assert.equal(typeof state.positionAt, 'number');
	assert.ok(state.positionAt > 0);
});

test('airplay metadata parser scales 48kHz AirPlay 2 progress against astm duration', () => {
	// This kiosk's AirPlay 2 path is 48kHz. Dividing RTP by 44100 made a
	// 2:00 scrub land at ~2:10 (120 * 48000/44100).
	const xml =
		item('636f7265', '6d696e6d', 'My Way') +
		item('636f7265', '6173746d', '200000') +
		item('73736e63', '70726772', '0/5760000/9600000');
	const state = parse(xml);
	assert.equal(state.length, 200);
	assert.ok(Math.abs(state.position - 120) < 0.05);
});

test('airplay metadata parser rescales an earlier 48kHz prgr once astm duration arrives', () => {
	const xml =
		item('636f7265', '6d696e6d', 'My Way') +
		item('73736e63', '70726772', '0/5760000/9600000') +
		item('636f7265', '6173746d', '200000');
	const state = parse(xml);
	assert.equal(state.length, 200);
	assert.ok(Math.abs(state.position - 120) < 0.05);
});

test('airplay metadata parser does not restamp the clock on a play-status while already playing', () => {
	const xml =
		item('636f7265', '6d696e6d', 'My Way') +
		item('73736e63', '70726772', '0/441000/12039300') +
		item('73736e63', '63617073', String.fromCharCode(2)) +
		item('73736e63', '7072736d');
	const state = parse(xml);
	assert.equal(state.playing, true);
	assert.equal(state.position, 10);
});

test('airplay metadata parser does not resume a paused track on a title restamp', () => {
	const xml =
		item('636f7265', '6d696e6d', 'My Way') +
		item('73736e63', '63617073', String.fromCharCode(3)) +
		item('636f7265', '6d696e6d', 'My Way');
	const state = parse(xml);
	assert.equal(state.playing, false);
	assert.equal(state.paused, true);
	assert.equal(state.title, 'My Way');
});

test('airplay metadata parser marks seeking when the title changes', () => {
	const xml =
		item('636f7265', '6d696e6d', 'My Way') +
		item('73736e63', '70726772', '0/441000/12039300') +
		item('636f7265', '6d696e6d', 'Daylight');
	const state = parse(xml);
	assert.equal(state.title, 'Daylight');
	assert.equal(state.position, 0);
	assert.equal(state.seeking, true);
	assert.equal(state.playing, true);
});
