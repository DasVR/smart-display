/**
 * "Play Bohemian Rhapsody", "play some jazz", "put on my workout playlist":
 * what to look for in Apple Music and which search result to start.
 *
 *  - parsePlayRequest(sentence): { term, kind } or null. Bare "play" /
 *    "play the music" stay plain transport (wallActions handles those).
 *  - pickResult(results, kind): the item to queue from a catalog search's
 *    `results` (MusicKit /v1/catalog/{storefront}/search with topResults).
 *  - speakPick(pick): "Playing Bohemian Rhapsody by Queen."
 *
 * Pure: src/lib/server/appleMusic.js runs it; tests/music-request.test.mjs.
 */

const PLAY_VERB = /^(?:play|put on|shuffle|listen to|start playing|i want to (?:hear|listen to)|let'?s (?:hear|listen to))\s+(.+)$/i;
const TRANSPORT_ONLY = /^(?:the\s+)?(?:music|song|track|playback|it|that)$/i;
const ANYTHING = /^(?:something|anything|some music|music|my music|some tunes|a song)(?: (?:good|nice|for me))?$/i;
// "play with the dog at 5", "play tennis every Tuesday": chores, not music
const CHORE_HINT = /^with\b|\b(?:at \d|at noon|tomorrow|every|each|on (?:mon|tue|wed|thu|fri|sat|sun)\w*|in \d+ (?:min|hour|day))/i;
const TRAILING = /\s+(?:on apple music|on the wall|in here|for me|please|now)$/i;

/** What a sentence asks to play, or null when it isn't a play request. */
export function parsePlayRequest(sentence) {
	const m = String(sentence || '')
		.trim()
		.match(PLAY_VERB);
	if (!m) return null;
	let rest = m[1].trim();
	while (TRAILING.test(rest)) rest = rest.replace(TRAILING, '').trim();
	if (!rest || TRANSPORT_ONLY.test(rest) || CHORE_HINT.test(rest)) return null;
	if (ANYTHING.test(rest)) return { term: '', kind: 'recent' };

	let x;
	if ((x = rest.match(/^my\s+(.+?)\s+playlist$/i)) || (x = rest.match(/^my playlist\s+(.+)$/i))) return { term: x[1], kind: 'library-playlist' };
	if ((x = rest.match(/^(?:the\s+)?playlist\s+(.+)$/i)) || (x = rest.match(/^(?:the\s+)?(.+?)\s+playlist$/i))) return { term: x[1], kind: 'playlist' };
	if ((x = rest.match(/^(?:the\s+)?album\s+(.+)$/i)) || (x = rest.match(/^(?:the\s+)?(.+?)\s+album$/i))) return { term: x[1], kind: 'album' };
	if ((x = rest.match(/^(.+?)\s+(?:radio|station)$/i))) return { term: `${x[1]} radio`, kind: 'station' };
	if ((x = rest.match(/^(?:songs|music|tracks|hits|stuff)\s+(?:by|from)\s+(.+)$/i)) || (x = rest.match(/^(.+?)'s?\s+(?:songs|music|hits)$/i)))
		return { term: x[1], kind: 'artist' };
	if ((x = rest.match(/^(?:some|a little|a bit of)\s+(.+?)(?:\s+music)?$/i)) || (x = rest.match(/^(.+?)\s+music$/i))) return { term: x[1], kind: 'genre' };
	return { term: rest.replace(/^the\s+song\s+/i, ''), kind: 'any' };
}

const KIND_TYPES = {
	playlist: ['playlists'],
	album: ['albums'],
	station: ['stations', 'playlists'],
	artist: ['artists'],
	genre: ['stations', 'playlists'],
	any: ['topResults', 'songs', 'albums', 'artists', 'playlists', 'stations']
};

/** The search types to ask for, as MusicKit's `types` parameter. */
export function searchTypes(kind) {
	if (kind === 'any') return 'songs,albums,artists,playlists,stations';
	return (KIND_TYPES[kind] || KIND_TYPES.any).join(',');
}

function asPick(item) {
	if (!item?.id || !item?.type) return null;
	const a = item.attributes || {};
	return { type: item.type, id: item.id, name: a.name || '', artistName: a.artistName || a.curatorName || '' };
}

/** The best thing to queue from a catalog search, by what was asked for. */
export function pickResult(results, kind = 'any') {
	const rs = results || {};
	for (const bucket of KIND_TYPES[kind] || KIND_TYPES.any) {
		const first = asPick(rs[bucket]?.data?.[0]);
		if (first) return first;
	}
	return null;
}

/** MusicKit setQueue options for a pick. */
export function queueFor(pick) {
	const key = { songs: 'song', albums: 'album', playlists: 'playlist', stations: 'station', 'library-playlists': 'playlist', 'library-albums': 'album', 'library-songs': 'song' }[pick?.type];
	return key ? { [key]: pick.id } : null;
}

export function speakPick(pick) {
	if (!pick) return "I couldn't find that on Apple Music.";
	const name = pick.name || 'that';
	if (pick.type === 'songs') return pick.artistName ? `Playing ${name} by ${pick.artistName}.` : `Playing ${name}.`;
	if (pick.type === 'albums') return pick.artistName ? `Playing the album ${name} by ${pick.artistName}.` : `Playing the album ${name}.`;
	if (pick.type === 'playlists' || pick.type === 'library-playlists') return `Playing the ${name.replace(/\s+playlist$/i, '')} playlist.`;
	if (pick.type === 'artists') return `Playing ${name}.`;
	return `Playing ${name}.`;
}
