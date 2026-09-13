const DEMO_ART =
	'data:image/svg+xml,' +
	encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2430"/>
      <stop offset="0.55" stop-color="#3a2318"/>
      <stop offset="1" stop-color="#c45a2a"/>
    </linearGradient>
  </defs>
  <rect width="900" height="560" fill="url(#g)"/>
  <circle cx="250" cy="280" r="168" fill="none" stroke="#f4e4c8" stroke-width="10"/>
  <circle cx="250" cy="280" r="28" fill="#f4e4c8"/>
  <text x="480" y="250" fill="#f4e4c8" font-family="Georgia, serif" font-size="54">Night Drive</text>
  <text x="480" y="310" fill="#f4e4c8" font-family="sans-serif" font-size="28" opacity="0.8">Demo FM</text>
</svg>`);

const DEMO_LYRICS = [
	{ time: 0.4, text: 'Headlights on the causeway', words: [
		{ time: 0.4, text: 'Headlights' },
		{ time: 1.1, text: 'on' },
		{ time: 1.4, text: 'the' },
		{ time: 1.6, text: 'causeway' }
	]},
	{ time: 4.2, text: 'Salt air through the vents', words: [
		{ time: 4.2, text: 'Salt' },
		{ time: 4.6, text: 'air' },
		{ time: 5.0, text: 'through' },
		{ time: 5.4, text: 'the' },
		{ time: 5.7, text: 'vents' }
	]},
	{ time: 8.0, text: 'Keep the chorus low', words: [
		{ time: 8.0, text: 'Keep' },
		{ time: 8.4, text: 'the' },
		{ time: 8.7, text: 'chorus' },
		{ time: 9.3, text: 'low' }
	]},
	{ time: 12.2, text: 'Let the gulf take the rest', words: [
		{ time: 12.2, text: 'Let' },
		{ time: 12.5, text: 'the' },
		{ time: 12.8, text: 'gulf' },
		{ time: 13.3, text: 'take' },
		{ time: 13.7, text: 'the' },
		{ time: 14.0, text: 'rest' }
	]},
	{ time: 16.4, text: 'No map, just the long way home', words: [
		{ time: 16.4, text: 'No' },
		{ time: 16.7, text: 'map,' },
		{ time: 17.3, text: 'just' },
		{ time: 17.7, text: 'the' },
		{ time: 18.0, text: 'long' },
		{ time: 18.5, text: 'way' },
		{ time: 18.9, text: 'home' }
	]},
	// A bare timed marker with no text - an instrumental break in the demo,
	// same as a real LRC file's blank-line convention. The three-dot
	// indicator's opacity rises across this whole gap.
	{ time: 19.6, text: '' },
	{ time: 27.0, text: 'Radio humming in the dark' },
	{ time: 31.2, text: 'Every mile a quieter spark' },
	{ time: 35.4, text: 'Hold this note until the dawn' }
];

/** Local preview payload for `?demo=music` / `?island=music`. */
export function demoNowPlaying(now = Date.now()) {
	return {
		playing: true,
		paused: false,
		title: 'Night Drive',
		artist: 'Demo FM',
		album: 'Late Causeway',
		art: DEMO_ART,
		position: 8,
		positionAt: now - 8000,
		length: 214,
		source: 'airplay',
		lyrics: DEMO_LYRICS
	};
}
