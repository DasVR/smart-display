import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppleMusic, desktopUserAgent, findChrome, sampleToTrack } from '../src/lib/server/appleMusic.js';
import { ENHANCER_SOURCE } from '../src/lib/server/appleMusicEnhancer.js';
import { pickWithAppleMusic } from '../src/lib/server/hostData.js';

const quiet = { warn() {}, info() {} };
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'apple-music-'));

/** A stand-in for music.apple.com: answers the player's in-page calls by name. */
function fakePage({ authorized = true, search = {}, topSongs = [], library = null, recent = null } = {}) {
	const calls = [];
	const state = { playbackState: 0, queue: null, enhance: null, item: null };
	const handlers = {
		inPageReady: () => ({ authorized, storefront: 'gb' }),
		inPageStatus: () => ({ authorized, state: state.playbackState, time: 12, duration: 200, item: state.item, enhancer: { enabled: state.enhance, wired: 1, level: 0.2 } }),
		inPageApi: ({ url, params }) => {
			if (url.includes('/search') && url.includes('/me/library')) return library;
			if (url.includes('/search')) return { results: search };
			if (url.includes('/top-songs')) return { data: topSongs.map((id) => ({ id })) };
			if (url.includes('/recent/played')) return recent;
			throw new Error('unexpected ' + url + JSON.stringify(params));
		},
		inPageQueue: (arg) => {
			state.queue = arg;
			state.playbackState = 2;
			state.item = { id: 'x', name: 'Bohemian Rhapsody', artistName: 'Queen', albumName: 'A Night at the Opera', art: 'https://a/600x600.jpg' };
			return 2;
		},
		inPageControl: (action) => {
			state.playbackState = action === 'pause' ? 3 : 2;
			return state.playbackState;
		},
		inPageEnhance: (on) => {
			state.enhance = on;
			return null;
		}
	};
	const page = {
		async evaluate(fn, arg) {
			calls.push([fn.name, arg]);
			const h = handlers[fn.name];
			if (!h) throw new Error('no handler for ' + fn.name);
			return h(arg);
		}
	};
	return { page, calls, state };
}

function player(fake, opts = {}) {
	const launches = [];
	let closed = 0;
	const am = createAppleMusic({
		dataDir: tmp(),
		env: {},
		log: quiet,
		exists: (p) => p === '/opt/google/chrome/chrome',
		launch: async (args) => {
			launches.push(args);
			return { page: fake.page, context: { close: async () => closed++ } };
		},
		...opts
	});
	return { am, launches, closed: () => closed };
}

const queen = { type: 'songs', id: '1', attributes: { name: 'Bohemian Rhapsody', artistName: 'Queen' } };

test('findChrome wants Google Chrome (Widevine), and an override must exist', () => {
	assert.equal(findChrome({}, (p) => p === '/usr/bin/google-chrome-stable'), '/usr/bin/google-chrome-stable');
	assert.equal(findChrome({}, () => false), '');
	assert.equal(findChrome({ APPLE_MUSIC_CHROME: '/x/chrome' }, () => false), '');
	assert.equal(findChrome({ APPLE_MUSIC_CHROME: '/x/chrome' }, () => true), '/x/chrome');
});

test('desktopUserAgent hides headless', () => {
	assert.match(desktopUserAgent('Google Chrome 141.0.7390.54'), /Chrome\/141\.0\.0\.0 Safari/);
	assert.doesNotMatch(desktopUserAgent(''), /Headless/);
});

test('play: searches the storefront, queues the top result, says what it is', async () => {
	const fake = fakePage({ search: { topResults: { data: [queen] }, songs: { data: [queen] } } });
	const { am, launches } = player(fake);
	const r = await am.play('play bohemian rhapsody');
	assert.equal(r.ok, true);
	assert.equal(r.say, 'Playing Bohemian Rhapsody by Queen.');
	assert.equal(launches.length, 1);
	assert.equal(launches[0].executablePath, '/opt/google/chrome/chrome');
	assert.equal(launches[0].enhance, true);
	const api = fake.calls.find(([n]) => n === 'inPageApi')[1];
	assert.equal(api.url, '/v1/catalog/gb/search');
	assert.equal(api.params.with, 'topResults');
	assert.deepEqual(fake.state.queue, { queue: { song: '1' }, songs: null, shuffle: false });
	await am.close();
});

test('play: an artist plays their top songs shuffled', async () => {
	const fake = fakePage({ search: { topResults: { data: [{ type: 'artists', id: '159260351', attributes: { name: 'Taylor Swift' } }] } }, topSongs: ['a', 'b', 'c'] });
	const { am } = player(fake);
	const r = await am.play({ term: 'taylor swift', kind: 'any' });
	assert.equal(r.say, 'Playing Taylor Swift.');
	assert.deepEqual(fake.state.queue, { queue: null, songs: ['a', 'b', 'c'], shuffle: true });
	await am.close();
});

test('play: "my workout playlist" looks in the library first', async () => {
	const fake = fakePage({ library: { results: { 'library-playlists': { data: [{ id: 'p.123', attributes: { name: 'Workout' } }] } } } });
	const { am } = player(fake);
	const r = await am.play('play my workout playlist');
	assert.equal(r.say, 'Playing the Workout playlist.');
	assert.deepEqual(fake.state.queue.queue, { playlist: 'p.123' });
	await am.close();
});

test('play: signed out, nothing found, no Chrome', async () => {
	const signedOut = player(fakePage({ authorized: false }));
	const r1 = await signedOut.am.play('play abba');
	assert.equal(r1.reason, 'signed-out');
	await signedOut.am.close();

	const empty = player(fakePage({ search: {} }));
	const r2 = await empty.am.play('play zzzz qqqq');
	assert.equal(r2.reason, 'not-found');
	assert.equal(r2.say, "I couldn't find that on Apple Music.");
	await empty.am.close();

	const noChrome = createAppleMusic({ dataDir: tmp(), env: {}, log: quiet, exists: () => false, launch: async () => assert.fail('no launch') });
	const r3 = await noChrome.play('play abba');
	assert.equal(r3.reason, 'no-chrome');
});

test('control, track and isActive follow the page', async () => {
	const fake = fakePage({ search: { topResults: { data: [queen] } } });
	const changes = [];
	const { am } = player(fake, { onChange: (t) => changes.push(t?.playing ?? null) });
	assert.deepEqual(await am.control('pause'), { ok: false, reason: 'idle' });
	await am.play('play bohemian rhapsody');
	await new Promise((r) => setTimeout(r, 400));
	assert.equal(am.isActive(), true);
	assert.equal(am.track().title, 'Bohemian Rhapsody');
	assert.equal(am.track().source, 'apple-music');
	assert.deepEqual(await am.control('pause'), { ok: true });
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(am.track().playing, false);
	assert.equal(am.track().paused, true);
	assert.deepEqual(changes, [true, false]);
	await am.close();
	assert.equal(am.isActive(), false);
});

test('the enhancer setting is saved and pushed to the running page', async () => {
	const fake = fakePage({ search: { topResults: { data: [queen] } } });
	const dataDir = tmp();
	const am = createAppleMusic({ dataDir, env: {}, log: quiet, exists: () => true, launch: async (a) => ({ page: fake.page, context: { close: async () => {} }, ...a }) });
	await am.play('play bohemian rhapsody');
	assert.equal(fake.state.enhance, true);
	await am.setSettings({ enhance: false });
	assert.equal(fake.state.enhance, false);
	assert.deepEqual(JSON.parse(readFileSync(path.join(dataDir, 'apple-music.json'), 'utf8')), { enhance: false });
	assert.equal(am.snapshot().enhance, false);
	await am.close();
});

test('sampleToTrack', () => {
	assert.equal(sampleToTrack(null), null);
	const t = sampleToTrack({ state: 2, time: 30, duration: 0, item: { name: 'Song', artistName: 'Artist', durationMs: 180000 } }, 5);
	assert.deepEqual([t.playing, t.position, t.positionAt, t.length, t.player], [true, 30, 5, 180, 'Apple Music']);
});

test('pickWithAppleMusic: the wall player shows while it plays; the phone takes over', () => {
	const am = { title: 'Wall song', playing: true, source: 'apple-music' };
	let paused = 0;
	const source = (track) => ({ track: () => track, pause: () => paused++ });
	const idle = { playing: false };
	const phone = { title: 'Phone song', playing: true, source: 'airplay' };
	assert.equal(pickWithAppleMusic(idle, source(am)), am);
	assert.equal(pickWithAppleMusic(phone, source(am)), phone);
	assert.equal(paused, 1, 'the wall player pauses when the phone starts');
	const amPaused = { ...am, playing: false };
	assert.equal(pickWithAppleMusic(idle, source(amPaused)), amPaused);
	assert.equal(pickWithAppleMusic(phone, source(amPaused)), phone);
	assert.equal(pickWithAppleMusic(phone, null), phone);
	assert.equal(pickWithAppleMusic({ unavailable: true, playing: false }, source(am)), am);
});

test('the enhancer script is self-contained and stays out when switched off', () => {
	assert.match(ENHANCER_SOURCE, /__wallEnhancerOff/);
	assert.match(ENHANCER_SOURCE, /createMediaElementSource/);
	assert.doesNotThrow(() => new Function(ENHANCER_SOURCE));
});
