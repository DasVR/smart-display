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
		{ time: 0.4, end: 1.1, text: 'Headlights' },
		{ time: 1.1, end: 1.4, text: 'on' },
		{ time: 1.4, end: 1.6, text: 'the' },
		{ time: 1.6, end: 2.15, text: 'causeway' }
	]},
	{ time: 4.2, text: 'Salt air through the vents', words: [
		{ time: 4.2, end: 4.6, text: 'Salt' },
		{ time: 4.6, end: 5.0, text: 'air' },
		{ time: 5.0, end: 5.4, text: 'through' },
		{ time: 5.4, end: 5.7, text: 'the' },
		{ time: 5.7, end: 6.2, text: 'vents' }
	]},
	{ time: 8.0, text: 'Keep the chorus low', words: [
		{ time: 8.0, end: 8.4, text: 'Keep' },
		{ time: 8.4, end: 8.7, text: 'the' },
		{ time: 8.7, end: 9.3, text: 'chorus' },
		{ time: 9.3, end: 9.8, text: 'low' }
	]},
	{ time: 12.2, text: 'Let the gulf take the rest', words: [
		{ time: 12.2, end: 12.5, text: 'Let' },
		{ time: 12.5, end: 12.8, text: 'the' },
		{ time: 12.8, end: 13.3, text: 'gulf' },
		{ time: 13.3, end: 13.7, text: 'take' },
		{ time: 13.7, end: 14.0, text: 'the' },
		{ time: 14.0, end: 14.6, text: 'rest' }
	]},
	{ time: 16.4, text: 'No map, just the long way home', words: [
		{ time: 16.4, end: 16.7, text: 'No' },
		{ time: 16.7, end: 17.3, text: 'map,' },
		{ time: 17.3, end: 17.7, text: 'just' },
		{ time: 17.7, end: 18.0, text: 'the' },
		{ time: 18.0, end: 18.5, text: 'long' },
		{ time: 18.5, end: 18.9, text: 'way' },
		{ time: 18.9, end: 19.4, text: 'home' }
	]},
	// A timed em dash / rest glyph - community files stamp these for
	// instrumentals. cleanLyricLines turns them into a blank marker so the
	// three-dot indicator runs across the break instead of showing "—".
	{ time: 19.6, text: '—' },
	{ time: 27.0, text: 'Radio humming in the dark' },
	{ time: 31.2, text: 'Every mile a quieter spark' },
	{ time: 35.4, text: 'Hold this note until the dawn' }
];

/** Local preview payload for `?demo=music` / `?island=music`.
 *  Pass `position` to start at a clock (seconds). Pass `freeze: true` to
 *  hold that clock still so a specific lyric phase can be inspected. */
export function demoNowPlaying(now = Date.now(), { position = 7, freeze = false } = {}) {
	const pos = Number.isFinite(Number(position)) ? Number(position) : 7;
	return {
		playing: !freeze,
		paused: freeze,
		title: 'Night Drive',
		artist: 'Demo FM',
		album: 'Late Causeway',
		art: DEMO_ART,
		position: pos,
		positionAt: freeze ? now : now - pos * 1000,
		length: 214,
		source: 'airplay',
		lyrics: DEMO_LYRICS
	};
}
