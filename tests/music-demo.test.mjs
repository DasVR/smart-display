import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { DEMO_START_SEC, DEMO_TRACK, demoNowPlaying } from '../src/lib/musicDemo.js';

const DEMO_SRC = readFileSync(fileURLToPath(new URL('../src/lib/musicDemo.js', import.meta.url)), 'utf8');

test('demoNowPlaying is No Surprises and does not bake in lyric lines', () => {
	const track = demoNowPlaying(1_700_000_000_000, { position: 25 });
	assert.equal(track.title, 'No Surprises');
	assert.equal(track.artist, 'Radiohead');
	assert.equal(track.album, 'OK Computer');
	assert.equal(track.length, DEMO_TRACK.length);
	assert.equal(track.length, 228);
	assert.equal(track.position, DEMO_START_SEC);
	assert.equal(DEMO_START_SEC, 25);
	assert.equal(track.lyrics, null);
	assert.equal(track.lyricsPending, true);
});

test('demoNowPlaying freeze holds the clock still', () => {
	const now = 1_700_000_000_000;
	const track = demoNowPlaying(now, { position: 40, freeze: true, lyrics: [{ time: 26, text: 'x' }] });
	assert.equal(track.playing, false);
	assert.equal(track.paused, true);
	assert.equal(track.positionAt, now);
	assert.equal(track.lyricsPending, false);
});

test('musicDemo source has track metadata only, no lyric word timings', () => {
	assert.match(DEMO_SRC, /title: 'No Surprises'/);
	assert.match(DEMO_SRC, /artist: 'Radiohead'/);
	assert.doesNotMatch(DEMO_SRC, /DEMO_LYRICS/);
	assert.doesNotMatch(DEMO_SRC, /\bwords:\s*\[/);
	assert.doesNotMatch(DEMO_SRC, /time:\s*\d+\.\d+,\s*text:/);
});
