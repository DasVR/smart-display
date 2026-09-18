import { annotateLyricVoices } from './lyricVoices.js';

/** Local `?demo=voices` preview so call-and-response layout can be frozen
 *  without baking a real song's lyrics into the tree. */
export const VOICE_DEMO_TRACK = {
	title: 'Call And Response',
	artist: 'Demo',
	album: '',
	length: 12
};

const DEMO_ART =
	'data:image/svg+xml,' +
	encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a1824"/>
      <stop offset="1" stop-color="#3a3248"/>
    </linearGradient>
  </defs>
  <rect width="900" height="560" fill="url(#g)"/>
  <circle cx="250" cy="280" r="168" fill="none" stroke="#d7d0e8" stroke-width="10"/>
  <circle cx="250" cy="280" r="28" fill="#d7d0e8"/>
  <text x="480" y="250" fill="#d7d0e8" font-family="Georgia, serif" font-size="42">Call And Response</text>
  <text x="480" y="310" fill="#d7d0e8" font-family="sans-serif" font-size="24" opacity="0.8">Demo</text>
</svg>`);

function word(time, text, end) {
	return { time, text, end };
}

export const VOICE_DEMO_LINES = annotateLyricVoices([
	{
		time: 0.4,
		end: 2.6,
		agent: 'v1',
		text: 'Call it out',
		words: [word(0.4, 'Call', 0.75), word(0.75, 'it', 0.95), word(0.95, 'out', 2.4)]
	},
	{
		time: 1.15,
		end: 3.1,
		agent: 'v2',
		text: 'Send it back',
		words: [word(1.15, 'Send', 1.5), word(1.5, 'it', 1.7), word(1.7, 'back', 3.0)]
	},
	{
		time: 3.5,
		end: 6.4,
		agent: 'v1',
		text: 'Keep the line',
		words: [word(3.5, 'Keep', 3.9), word(3.9, 'the', 4.2), word(4.2, 'line', 6.2)],
		background: [
			{
				time: 4.7,
				end: 5.6,
				text: 'now',
				words: [word(4.7, 'now', 5.6)]
			},
			{
				time: 5.7,
				end: 6.3,
				text: 'hold it',
				words: [word(5.7, 'hold', 6.0), word(6.0, 'it', 6.3)]
			}
		]
	},
	{
		time: 6.8,
		end: 8.2,
		text: 'Alex: You coming',
		words: [word(6.8, 'Alex:', 7.1), word(7.1, 'You', 7.4), word(7.4, 'coming', 8.1)]
	},
	{
		time: 8.4,
		end: 10.4,
		text: 'Sam: In a minute',
		words: [word(8.4, 'Sam:', 8.7), word(8.7, 'In', 8.95), word(8.95, 'a', 9.15), word(9.15, 'minute', 10.3)]
	}
]);

export function voiceDemoNowPlaying(
	now = Date.now(),
	{ position = 1.6, freeze = false } = {}
) {
	const pos = Number.isFinite(Number(position)) ? Number(position) : 1.6;
	return {
		playing: !freeze,
		paused: freeze,
		title: VOICE_DEMO_TRACK.title,
		artist: VOICE_DEMO_TRACK.artist,
		album: VOICE_DEMO_TRACK.album,
		art: DEMO_ART,
		position: pos,
		positionAt: freeze ? now : now - pos * 1000,
		length: VOICE_DEMO_TRACK.length,
		source: 'airplay',
		lyrics: VOICE_DEMO_LINES,
		lyricsPending: false
	};
}
