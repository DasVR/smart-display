/** The track the GitHub Pages demo plays: an invented title with original
 *  lyrics (see staticDemo.js), so the public demo names no real song. */

const DEMO_TRACK_ART =
	'data:image/svg+xml,' +
	encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#141a2c"/>
      <stop offset="0.55" stop-color="#2a3150"/>
      <stop offset="1" stop-color="#8a90c8"/>
    </linearGradient>
  </defs>
  <rect width="900" height="560" fill="url(#g)"/>
  <circle cx="250" cy="280" r="168" fill="none" stroke="#dfe2f6" stroke-width="10"/>
  <circle cx="250" cy="280" r="28" fill="#dfe2f6"/>
  <text x="480" y="250" fill="#dfe2f6" font-family="Georgia, serif" font-size="48">Glass Hours</text>
  <text x="480" y="310" fill="#dfe2f6" font-family="sans-serif" font-size="26" opacity="0.8">Smart Display Demo</text>
</svg>`);

export const PAGES_DEMO_TRACK = {
	title: 'Glass Hours',
	artist: 'Smart Display Demo',
	album: 'Demo Sessions',
	art: DEMO_TRACK_ART
};
