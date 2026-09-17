export const DEMO_TRACK = {
	title: 'No Surprises',
	artist: 'Radiohead',
	album: 'OK Computer',
	length: 228
};

const DEMO_ART =
	'data:image/svg+xml,' +
	encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a2420"/>
      <stop offset="0.55" stop-color="#2c3a32"/>
      <stop offset="1" stop-color="#6b7a62"/>
    </linearGradient>
  </defs>
  <rect width="900" height="560" fill="url(#g)"/>
  <circle cx="250" cy="280" r="168" fill="none" stroke="#d7e0c8" stroke-width="10"/>
  <circle cx="250" cy="280" r="28" fill="#d7e0c8"/>
  <text x="480" y="250" fill="#d7e0c8" font-family="Georgia, serif" font-size="48">No Surprises</text>
  <text x="480" y="310" fill="#d7e0c8" font-family="sans-serif" font-size="26" opacity="0.8">Radiohead</text>
</svg>`);

/** First sung line in the community word-sync for this track sits just
 *  after 25s of glockenspiel intro, so the demo clock starts there. */
export const DEMO_START_SEC = 25;

/** Local preview payload for `?demo=music` / `?island=music`.
 *  Lyrics are filled in by the server from the same community lookup the
 *  kiosk uses for a real AirPlay track - nothing copyrighted is baked in.
 *  Pass `position` to start at a clock (seconds). Pass `freeze: true` to
 *  hold that clock still so a specific lyric phase can be inspected. */
export function demoNowPlaying(
	now = Date.now(),
	{ position = DEMO_START_SEC, freeze = false, lyrics = null, lyricsPending } = {}
) {
	const pos = Number.isFinite(Number(position)) ? Number(position) : DEMO_START_SEC;
	const pending = lyricsPending ?? !lyrics;
	return {
		playing: !freeze,
		paused: freeze,
		title: DEMO_TRACK.title,
		artist: DEMO_TRACK.artist,
		album: DEMO_TRACK.album,
		art: DEMO_ART,
		position: pos,
		positionAt: freeze ? now : now - pos * 1000,
		length: DEMO_TRACK.length,
		source: 'airplay',
		lyrics,
		lyricsPending: pending
	};
}
