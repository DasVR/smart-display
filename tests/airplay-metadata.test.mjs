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
