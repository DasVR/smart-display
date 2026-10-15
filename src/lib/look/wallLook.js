// The wall's look: which skin the pages wear, and which painting is behind
// them. Pure helpers shared by the server (data/look.json) and the kiosk.

/** How each look dresses the Clock page (the rest share the halftone chrome):
 *  halftone  the painting in dots behind two graphite glass cards, tabs in a pill at the bottom
 *  paper     cream paper cards across the top with dotted shadows, the painting below
 *  poster    the time huge across the painting, three small tiles underneath
 *  depth     the poster, with the painting's shadows printed back over the numerals
 *  riso      paper cards printed in two inks, teal and tangerine, slightly off-register
 *  console   no painting: off-white hardware, dot-matrix time, signal orange, page tiles
 *  classic   the liquid-metal wall from before */
export const LOOKS = ['halftone', 'paper', 'poster', 'depth', 'riso', 'console', 'classic'];

export const LOOK_LABELS = {
	halftone: 'Glass',
	paper: 'Paper',
	poster: 'Poster',
	depth: 'Depth',
	riso: 'Riso',
	console: 'Console',
	classic: 'Classic'
};

/** Public-domain paintings in static/art/. 'auto' picks one by time of day. */
export const ARTWORKS = {
	almond: { title: 'Almond Blossom', artist: 'Vincent van Gogh, 1890' },
	magpie: { title: 'The Magpie', artist: 'Claude Monet, 1869' },
	poppies: { title: 'Poppy Field', artist: 'Claude Monet, 1873' },
	starry: { title: 'The Starry Night', artist: 'Vincent van Gogh, 1889' }
};

export const DEFAULT_LOOK = { look: 'halftone', art: 'auto' };

export function normalizeLook(raw = {}, prev = DEFAULT_LOOK) {
	const src = raw && typeof raw === 'object' ? raw : {};
	return {
		look: LOOKS.includes(src.look) ? src.look : LOOKS.includes(prev?.look) ? prev.look : DEFAULT_LOOK.look,
		art: src.art === 'auto' || src.art in ARTWORKS ? src.art : prev?.art === 'auto' || prev?.art in ARTWORKS ? prev.art : DEFAULT_LOOK.art
	};
}

/** The painting for this moment: a chosen one, or by the hour (blossom in the morning, the field by day, stars at night). */
export function artFor(art, hour) {
	if (art in ARTWORKS) return art;
	if (hour >= 5 && hour < 11) return 'almond';
	if (hour >= 11 && hour < 16) return 'poppies';
	if (hour >= 16 && hour < 20) return 'magpie';
	return 'starry';
}
