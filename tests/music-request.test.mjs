import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayRequest, pickResult, queueFor, searchTypes, speakPick } from '../src/lib/musicRequest.js';
import { parseCommand } from '../src/lib/wallActions.js';

test('parsePlayRequest reads what to play and how to look for it', () => {
	const cases = {
		'play bohemian rhapsody': { term: 'bohemian rhapsody', kind: 'any' },
		'play Blinding Lights by The Weeknd': { term: 'Blinding Lights by The Weeknd', kind: 'any' },
		'play taylor swift': { term: 'taylor swift', kind: 'any' },
		'put on some jazz': { term: 'jazz', kind: 'genre' },
		'play some relaxing music': { term: 'relaxing', kind: 'genre' },
		'play lofi music': { term: 'lofi', kind: 'genre' },
		'play my workout playlist': { term: 'workout', kind: 'library-playlist' },
		'play the chill vibes playlist': { term: 'chill vibes', kind: 'playlist' },
		'play the album rumours': { term: 'rumours', kind: 'album' },
		'play abbey road album': { term: 'abbey road', kind: 'album' },
		'play jazz radio': { term: 'jazz radio', kind: 'station' },
		'play songs by queen': { term: 'queen', kind: 'artist' },
		'shuffle drake': { term: 'drake', kind: 'any' },
		'play something': { term: '', kind: 'recent' },
		'play some music': { term: '', kind: 'recent' },
		'play the song yesterday on apple music': { term: 'yesterday', kind: 'any' }
	};
	for (const [said, want] of Object.entries(cases)) assert.deepEqual(parsePlayRequest(said), want, said);
});

test('parsePlayRequest leaves transport and chores alone', () => {
	for (const said of ['play', 'play the music', 'play music', 'play it', 'play with the dog at 5', 'play tennis every tuesday', 'pause', 'next song'])
		assert.equal(parsePlayRequest(said), null, said);
});

test('parseCommand turns "play X" into a play request, keeps bare play as transport', () => {
	assert.deepEqual(parseCommand('Hey wall, play Bohemian Rhapsody please'), { intent: 'play-request', term: 'Bohemian Rhapsody', kind: 'any' });
	assert.deepEqual(parseCommand('play the music'), { intent: 'music', action: 'play' });
	assert.deepEqual(parseCommand('resume'), { intent: 'music', action: 'play' });
	assert.equal(parseCommand('remind me to play piano at 6'), null);
});

const search = {
	topResults: { data: [{ type: 'artists', id: '159260351', attributes: { name: 'Taylor Swift' } }] },
	songs: { data: [{ type: 'songs', id: '1', attributes: { name: 'Patient Zero', artistName: 'Taylor Swift' } }] },
	albums: { data: [{ type: 'albums', id: '2', attributes: { name: 'Folklore', artistName: 'Taylor Swift' } }] },
	playlists: { data: [{ type: 'playlists', id: 'pl.1', attributes: { name: 'Taylor Swift Essentials', curatorName: 'Apple Music Pop' } }] },
	stations: { data: [{ type: 'stations', id: 'ra.1', attributes: { name: 'Taylor Swift Radio' } }] }
};

test('pickResult takes the top result for a plain request and the right bucket otherwise', () => {
	assert.equal(pickResult(search, 'any').type, 'artists');
	assert.equal(pickResult(search, 'album').name, 'Folklore');
	assert.equal(pickResult(search, 'playlist').id, 'pl.1');
	assert.equal(pickResult(search, 'genre').type, 'stations');
	assert.equal(pickResult({ playlists: search.playlists }, 'station').type, 'playlists');
	assert.equal(pickResult({}, 'any'), null);
	assert.equal(searchTypes('album'), 'albums');
	assert.match(searchTypes('any'), /songs.*stations/);
});

test('queueFor and speakPick', () => {
	assert.deepEqual(queueFor({ type: 'songs', id: '1' }), { song: '1' });
	assert.deepEqual(queueFor({ type: 'stations', id: 'ra.1' }), { station: 'ra.1' });
	assert.deepEqual(queueFor({ type: 'library-playlists', id: 'p.x' }), { playlist: 'p.x' });
	assert.equal(queueFor({ type: 'artists', id: '1' }), null);
	assert.equal(speakPick({ type: 'songs', name: 'Bohemian Rhapsody', artistName: 'Queen' }), 'Playing Bohemian Rhapsody by Queen.');
	assert.equal(speakPick({ type: 'playlists', name: 'Chill Vibes' }), 'Playing the Chill Vibes playlist.');
	assert.equal(speakPick(null), "I couldn't find that on Apple Music.");
});
