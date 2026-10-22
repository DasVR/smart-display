/**
 * The agents as little pixel characters (the wall's bottom edge).
 *
 * Clawd is decoded from the "Clawd opens a laptop" GIF (12 × 8, two oranges);
 * Cursor is a lit cube with a text-caret eye, Gemini a pair of twins and
 * Hermes a little messenger in a winged helmet, all drawn in his style. Every character has the same five poses (stand, windup,
 * stretch, sit, slump), so every state works for all of them.
 *
 * Pixel-art rules this follows (.claude/skills/pixel-art): whole pixels only,
 * subpixel motion by colour (half-tone pixels) rather than position, few
 * frames with anticipation and follow-through, frames timed in steps of the
 * GIF's 66 ms.
 *
 * Pure: renderFrame() turns a frame into rectangles, and the canvas side
 * (src/lib/components/AgentCharacter.svelte) only paints them.
 * tests/agent-sprites.test.mjs.
 */

/** One GIF frame. Every hold is a whole number of these. */
export const F = 66;
/** The stage, in art pixels: the sprite's left edge sits at OX, its feet on GROUND - 1. */
export const GRID = { W: 22, H: 14, OX: 6, GROUND: 12 };
/** What's behind the sprite, for half-tone pixels. */
const BG = '#0c0c0c';

export const CHARACTERS = {
	claude: {
		label: 'Claude',
		accent: '#d06a4b',
		palette: { B: '#d06a4b', D: '#b55c41', E: '#0c0c0c' },
		hand: [2, 4], // the near arm in the sit pose: its bottom pixels lift on a keystroke
		poses: {
			stand: [
				'..BBBBBBBB..',
				'..BEBBBBEB..',
				'BBBBBBBBBBBB',
				'BBBBBBBBBBBB',
				'..BBBBBBBB..',
				'..BBBBBBBB..',
				'..B.B..B.B..',
				'..B.B..B.B..'
			],
			// GIF frames 3–8: tilted, one arm a pixel up, the other a stepped pixel down, a wink
			windup: [
				'..BBBBBBBB..',
				'..BBBBBBBBBB',
				'..BEBBBEEBBB',
				'..BBBBBBBB..',
				'BBBBBBBBBB..',
				'.BBBBBBBBB..',
				'..B.B..B.B..',
				'..B.B..B.B..'
			],
			// GIF frame 17: arms up on top of the head, a pixel taller
			stretch: [
				'..BB....BB..',
				'..BBBBBBBB..',
				'..BBBBBBBB..',
				'..BEBBBBEB..',
				'..BBBBBBBB..',
				'..BBBBBBBB..',
				'..BBBBBBBB..',
				'..B.B..B.B..',
				'..B.B..B.B..'
			],
			// GIF frames 18–41: sitting turned to the laptop, near arm forward, boots
			sit: [
				'....BBBBBBDD',
				'....EBBEBBDD',
				'..BBBBBBBBDD',
				'..BBBBBBBBDD',
				'..BBBBBBBBDD',
				'...B..B..D..',
				'...BB.BB.DD.'
			],
			slump: [
				'..BBBBBBBB..',
				'..BBBBBBBB..',
				'..BEBBBBEB..',
				'.BBBBBBBBBB.',
				'.BBBBBBBBBB.',
				'..BBBBBBBB..',
				'..B.B..B.B..'
			]
		}
	},
	cursor: {
		label: 'Cursor',
		accent: '#d7d9e1',
		palette: { T: '#f3f4f8', F: '#c9cbd4', S: '#8d8f9c', E: '#0b0b10' },
		// the right eye is a text caret that blinks like one
		caret: { on: '#0b0b10', off: '#c9cbd4', ms: 530 },
		hand: [1, 4],
		poses: {
			stand: [
				'..TTTTTTTT..',
				'..FFFFFFFFS.',
				'..FEFFFFCFS.',
				'FFFFFFFFCFSF',
				'FFFFFFFFFFSF',
				'..FFFFFFFFS.',
				'..FFFFFFFFS.',
				'..F.F..F.F..',
				'..F.F..F.F..'
			],
			windup: [
				'..TTTTTTTT..',
				'..FFFFFFFFSF',
				'..FEEFFFCFSF',
				'..FFFFFFCFS.',
				'FFFFFFFFFFS.',
				'.FFFFFFFFFS.',
				'..FFFFFFFFS.',
				'..F.F..F.F..',
				'..F.F..F.F..'
			],
			stretch: [
				'F.TTTTTTTT.F',
				'F.FFFFFFFFSF',
				'..FFFFFFFFS.',
				'..FEFFFFCFS.',
				'..FFFFFFCFS.',
				'..FFFFFFFFS.',
				'..FFFFFFFFS.',
				'..FFFFFFFFS.',
				'..F.F..F.F..',
				'..F.F..F.F..'
			],
			sit: [
				'...TTTTTTT..',
				'...FFFFFSSS.',
				'...EFFCFSSS.',
				'.FFFFFFCSSS.',
				'.FFFFFFFSSS.',
				'...FFFFFSSS.',
				'...F..F.S...',
				'...FF.FF.SS.'
			],
			slump: [
				'..TTTTTTTT..',
				'..FFFFFFFFS.',
				'..FFFFFFFFS.',
				'..FEFFFFCFS.',
				'.FFFFFFFCFSF',
				'..FFFFFFFFS.',
				'..FFFFFFFFS.',
				'..F.F..F.F..'
			]
		}
	},
	gemini: {
		label: 'Gemini',
		accent: '#9a8cff',
		palette: { A: '#6f8cff', V: '#b48cff', H: '#9a8cff', a: '#4d63c4', v: '#8565cf', E: '#0d1030' },
		twinkle: true,
		hand: [0, 4],
		poses: {
			stand: [
				'AAAAA.......',
				'AEAEA..VVVVV',
				'AAAAA..VEVEV',
				'AAAAAHHVVVVV',
				'AAAAA..VVVVV',
				'.A.A...VVVVV',
				'.A.A....V.V.',
				'.A.A....V.V.'
			],
			windup: [
				'AAAAA......V',
				'AEAEE..VVVVV',
				'AAAAA..VEVEV',
				'AAAAAHHVVVVV',
				'AAAAA..VVVVV',
				'.A.A...VVVVV',
				'.A.A....V.V.',
				'.A.A....V.V.'
			],
			// joined hands go up between them
			stretch: [
				'.....HH.....',
				'AAAAAHHVVVVV',
				'AEAEA..VEVEV',
				'AAAAA..VVVVV',
				'AAAAA..VVVVV',
				'AAAAA..VVVVV',
				'.A.A...VVVVV',
				'.A.A....V.V.',
				'.A.A....V.V.'
			],
			// sitting, turned to each other, darker outer sides
			sit: [
				'aAAAA.......',
				'aAAEA..VVVVv',
				'aAAAA..VEVVv',
				'aAAAAHHVVVVv',
				'aAAAA..VVVVv',
				'.AA.A..VV.Vv'
			],
			slump: [
				'AAAAA.......',
				'AAAAA..VVVVV',
				'AEAEA..VVVVV',
				'AAAAA..VEVEV',
				'AAAAAHHVVVVV',
				'.A.A...VVVVV',
				'.A.A....V.V.'
			]
		}
	},
	hermes: {
		label: 'Hermes',
		accent: '#5fb3a8',
		// teal messenger, gold winged helmet and sandals, a darker side when turned
		palette: { B: '#5fb3a8', D: '#468a81', G: '#d9a441', g: '#a87a2a', W: '#f3efe4', X: '#f3efe4', E: '#0c0c0c' },
		// the wing tips (X) beat: full, then half-toned into the dark
		flutter: { ms: 330 },
		hand: [2, 4],
		poses: {
			stand: [
				'.X........X.',
				'WW.GGGGGG.WW',
				'.WGGGGGGGGW.',
				'..BEBBBBEB..',
				'BBBBBBBBBBBB',
				'..BBBBBBBB..',
				'..B.B..B.B..',
				'..G.G..G.G..'
			],
			// tilted a pixel right, one arm up, a wink
			windup: [
				'..X.......X.',
				'.WW.GGGGGGWW',
				'..WGGGGGGGGW',
				'...BEBBBEEB.',
				'..BBBBBBBBBB',
				'BBBBBBBBBB..',
				'..B.B..B.B..',
				'..G.G..G.G..'
			],
			// arms up beside the helmet, a pixel taller
			stretch: [
				'.BX......XB.',
				'WB.GGGGGG.BW',
				'.BGGGGGGGGB.',
				'..BEBBBBEB..',
				'..BBBBBBBB..',
				'..BBBBBBBB..',
				'..BBBBBBBB..',
				'..B.B..B.B..',
				'..G.G..G.G..'
			],
			// sitting turned to the laptop: the far wing up behind, the near one folded
			sit: [
				'.....GGGGg.X',
				'...WGGGGGGgW',
				'....EBBEBBDD',
				'..BBBBBBBBDD',
				'..BBBBBBBBDD',
				'...B..B..D..',
				'...GG.GG.gg.'
			],
			// head down, the wings drooping to its sides
			slump: [
				'...GGGGGG...',
				'..GGGGGGGG..',
				'WWBEBBBBEBWW',
				'.BBBBBBBBBB.',
				'.BBBBBBBBBB.',
				'..B.B..B.B..',
				'..G.G..G.G..'
			]
		}
	}
};

/** Which character an agent gets, from its name or id. Anything else gets none. */
export function characterFor(source = '') {
	const s = String(source || '').toLowerCase();
	if (s.includes('cursor')) return 'cursor';
	if (s.includes('gemini')) return 'gemini';
	if (s.includes('claude')) return 'claude';
	if (s.includes('hermes')) return 'hermes';
	return null;
}

/* ---------- pose edits ---------- */

const solid = (c) => c !== '.' && c !== 'E' && c !== 'C';
function edit(pose, fn) {
	const r = pose.map((row) => row.split(''));
	fn(r);
	return r.map((row) => row.join(''));
}
/** What an eye turns into when the lid closes: the body next to it. */
function lidAt(r, y, x) {
	for (const d of [-1, 1, -2, 2]) {
		const c = r[y][x + d];
		if (c && solid(c)) return c;
	}
	return 'B';
}
export const blink = (p) => edit(p, (r) => r.forEach((row, y) => row.forEach((c, x) => { if (c === 'E') r[y][x] = lidAt(r, y, x); })));
export const look = (d) => (p) =>
	edit(p, (r) => {
		const eyes = [];
		r.forEach((row, y) => row.forEach((c, x) => c === 'E' && eyes.push([y, x])));
		eyes.forEach(([y, x]) => {
			const t = r[y][x + d];
			if (t && solid(t)) {
				r[y][x] = lidAt(r, y, x);
				r[y][x + d] = 'E';
			}
		});
	});
/** One pixel lower on shorter legs: the bottom row goes and the sprite stands on what's left. */
export const crouch = (p) => p.slice(0, -1);

const cellsOf = (p, test) => {
	const out = [];
	p.forEach((row, y) => [...row].forEach((c, x) => test(c, x, y) && out.push([x, y])));
	return out;
};
const eyeCells = (p) => cellsOf(p, (c) => c === 'E');
const topRow = (p) => cellsOf(p, (c, x, y) => y === 0 && c !== '.');

/* ---------- little sequences, built from half-tone pixels ---------- */

/** A blink in three steps: half shut, shut, half open. */
const blinkSeq = (pose, extra = {}) => [
	{ ...extra, pose, half: eyeCells(pose), ms: F, name: 'lids' },
	{ ...extra, pose: blink(pose), ms: F, name: 'blink' },
	{ ...extra, pose, half: eyeCells(pose), ms: F, name: 'lids' }
];
/** A breath: the top row softens, it sinks a pixel, the top row softens on the way up. */
const breathSeq = (pose, extra = {}) => [
	{ ...extra, pose, half: topRow(pose), ms: 2 * F, name: 'in' },
	{ ...extra, pose: crouch(pose), ms: 4 * F, name: 'breath' },
	{ ...extra, pose, half: topRow(pose), ms: 2 * F, name: 'out' }
];

/* ---------- states ---------- */

const key = (P, L) => [
	{ ...L, pose: P.sit, typeHalf: 1, ms: F, name: 'press' },
	{ ...L, pose: P.sit, type: 1, ms: F, name: 'lift' },
	{ ...L, pose: P.sit, typeHalf: 1, ms: F, name: 'press' },
	{ ...L, pose: P.sit, ms: F, name: 'down' }
];

/**
 * A state is a list of frames. A frame: { pose, ms, name, dy?, half?, type?,
 * typeHalf?, laptop?: 'open'|'up'|'swing'|'shut', q? }. Looping states repeat;
 * the others play once and hold their last frame.
 */
export const STATES = {
	work: {
		loop: true,
		frames: (P) => {
			const L = { laptop: 'open' };
			return [
				...key(P, L), ...key(P, L), ...key(P, L),
				{ ...L, pose: P.sit, ms: 10 * F, name: 'read' }, ...blinkSeq(P.sit, L), { ...L, pose: P.sit, ms: 4 * F, name: 'read' },
				...key(P, L), ...key(P, L), { ...L, pose: P.sit, ms: 3 * F, name: 'think' },
				...key(P, L), ...key(P, L), ...key(P, L), ...key(P, L),
				...breathSeq(P.sit, L), { ...L, pose: P.sit, ms: 8 * F, name: 'read' }
			];
		}
	},
	// work -> ask: notices, shuts the lid (with a smear), stretches, lands facing you
	close: {
		loop: false,
		frames: (P) => [
			{ pose: P.sit, laptop: 'open', half: topRow(P.sit), ms: F, name: 'notice' },
			{ pose: P.sit, laptop: 'swing', ms: F, name: 'smear' },
			{ pose: P.sit, laptop: 'up', ms: F, name: 'lid up' },
			{ pose: P.sit, laptop: 'shut', ms: 2 * F, name: 'shut' },
			{ pose: crouch(P.sit), laptop: 'shut', ms: 2 * F, name: 'wind-up' },
			{ pose: P.stretch, laptop: 'shut', dy: -1, ms: 3 * F, name: 'stretch' },
			{ pose: P.stretch, laptop: 'shut', ms: F, name: 'down' },
			{ pose: crouch(P.stand), laptop: 'shut', ms: F, name: 'land' },
			{ pose: P.stand, laptop: 'shut', half: topRow(P.stand), ms: F, name: 'settle' },
			{ pose: P.stand, laptop: 'shut', ms: 3 * F, name: 'stand' }
		]
	},
	// stand -> work: wind-up and wink, lid up, smear, open, sit
	open: {
		loop: false,
		frames: (P) => [
			{ pose: P.windup, laptop: 'shut', ms: 4 * F, name: 'wind-up' },
			{ pose: P.stand, laptop: 'up', ms: 2 * F, name: 'lid up' },
			{ pose: P.stand, laptop: 'swing', ms: F, name: 'smear' },
			{ pose: P.stand, laptop: 'open', ms: 2 * F, name: 'open' },
			{ pose: crouch(P.stand), laptop: 'open', ms: F, name: 'sit down' },
			{ pose: P.sit, laptop: 'open', half: topRow(P.sit), ms: F, name: 'settle' },
			{ pose: P.sit, laptop: 'open', ms: 4 * F, name: 'sit' }
		]
	},
	ask: {
		loop: true,
		frames: (P) => [
			{ pose: P.windup, laptop: 'shut', q: 1, ms: 4 * F, name: 'tilt' },
			{ pose: P.stand, laptop: 'shut', q: 1, ms: 3 * F, name: 'stand' },
			{ pose: P.windup, laptop: 'shut', q: 1, ms: 4 * F, name: 'tilt' },
			{ pose: P.stand, laptop: 'shut', q: 1, ms: 14 * F, name: 'hold' },
			...blinkSeq(P.stand, { laptop: 'shut', q: 1 })
		]
	},
	yes: {
		loop: false,
		frames: (P) => [
			{ pose: P.stand, laptop: 'shut', half: topRow(P.stand), ms: F, name: 'dip' },
			{ pose: crouch(P.stand), laptop: 'shut', ms: 2 * F, name: 'wind-up' },
			{ pose: P.stretch, laptop: 'shut', dy: -1, ms: F, name: 'spring' },
			{ pose: P.stretch, laptop: 'shut', dy: -3, ms: 3 * F, name: 'hang' },
			{ pose: P.stretch, laptop: 'shut', dy: -1, ms: F, name: 'fall' },
			{ pose: crouch(P.stand), laptop: 'shut', ms: 2 * F, name: 'squash' },
			{ pose: P.stretch, laptop: 'shut', dy: -1, ms: 2 * F, name: 'hop' },
			{ pose: crouch(P.stand), laptop: 'shut', ms: F, name: 'land' },
			{ pose: P.stand, laptop: 'shut', half: topRow(P.stand), ms: F, name: 'settle' },
			{ pose: P.windup, laptop: 'shut', ms: 6 * F, name: 'wink' },
			{ pose: P.stand, laptop: 'shut', ms: 4 * F, name: 'stand' }
		]
	},
	no: {
		loop: false,
		frames: (P) => [
			{ pose: P.stand, laptop: 'shut', ms: 3 * F, name: 'stand' },
			...blinkSeq(P.stand, { laptop: 'shut' }),
			{ pose: P.slump, laptop: 'shut', half: topRow(P.slump), ms: 2 * F, name: 'sink' },
			{ pose: P.slump, laptop: 'shut', ms: 18 * F, name: 'slump' }
		]
	},
	idle: {
		loop: true,
		frames: (P) => [
			{ pose: P.stand, ms: 22 * F, name: 'stand' }, ...blinkSeq(P.stand), { pose: P.stand, ms: 20 * F, name: 'stand' },
			...breathSeq(P.stand), { pose: P.stand, ms: 16 * F, name: 'stand' },
			{ pose: look(-1)(P.stand), ms: 10 * F, name: 'look left' }, { pose: P.stand, ms: 3 * F, name: 'stand' },
			{ pose: look(1)(P.stand), ms: 10 * F, name: 'look right' }
		]
	}
};

export function framesFor(characterId, state) {
	const ch = CHARACTERS[characterId];
	const s = STATES[state];
	if (!ch || !s) return [];
	return s.frames(ch.poses);
}

/**
 * The way from one state to another. Sitting at the laptop and standing need
 * the lid opened or shut in between; everything else changes directly.
 */
export function pathTo(from, to) {
	if (from === to) return [to];
	const sitting = (s) => s === 'work' || s === 'open';
	if (sitting(from) && to !== 'work') return ['close', to];
	if (!sitting(from) && to === 'work') return ['open', 'work'];
	return [to];
}

/* ---------- rendering ---------- */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export function mix(a, b, k = 0.5) {
	const x = hex(a);
	const y = hex(b);
	return toHex(x.map((v, i) => v + (y[i] - v) * k));
}

const QMARK = ['BBB', '..B', '.BB', '...', '.B.'];
const LAPTOP = { base: '#8c8c8c', lid: '#a6a6a6' };

/**
 * Everything to paint for one frame at time `t` (ms, for the caret and the
 * twinkle): [{ x, y, color, alpha? }] in art pixels on the GRID.
 */
export function renderFrame(characterId, frame, t = 0) {
	const ch = CHARACTERS[characterId];
	if (!ch || !frame?.pose) return [];
	const { OX, GROUND } = GRID;
	const out = [];
	const dot = (x, y, color, alpha) => out.push(alpha ? { x, y, color, alpha } : { x, y, color });
	const paint = (c) => {
		if (c === 'C') return Math.floor(t / ch.caret.ms) % 2 ? ch.caret.off : ch.caret.on;
		// a wing beat by colour, not position: the tip half-tones into the dark and back
		if (c === 'X' && ch.flutter) return Math.floor(t / ch.flutter.ms) % 2 ? mix(ch.palette.X, BG) : ch.palette.X;
		return ch.palette[c];
	};

	// a keystroke lifts the near arm's bottom two pixels; a half keystroke fades them
	const [hx, hy] = ch.hand;
	let pose = frame.pose;
	if (frame.type) pose = edit(pose, (r) => { if (r[hy]) { r[hy][hx] = '.'; r[hy][hx + 1] = '.'; } });
	const half = new Set((frame.half || []).map(([x, y]) => `${x},${y}`));
	if (frame.typeHalf && pose[hy]) [hx, hx + 1].forEach((x) => half.add(`${x},${hy}`));

	const x0 = OX + (frame.dx || 0);
	const y0 = GROUND - pose.length + (frame.dy || 0);
	const rows = pose.map((row) => row.split(''));
	pose.forEach((row, y) =>
		[...row].forEach((c, x) => {
			if (c === '.') return;
			let color = paint(c);
			if (half.has(`${x},${y}`)) color = c === 'E' ? mix(paint(lidAt(rows, y, x)), color) : mix(color, BG);
			dot(x0 + x, y0 + y, color);
		})
	);

	// the laptop, side-on as in the GIF: base flat in front, hinge at the far end
	if (frame.laptop) {
		const g = GROUND - 1;
		const right = x0 + hx - 2;
		const hinge = right - 3;
		for (let i = 0; i < 4; i++) dot(right - i, g, LAPTOP.base);
		if (frame.laptop === 'open') for (let i = 1; i <= 4; i++) dot(hinge - i + 1, g - i, LAPTOP.lid);
		else if (frame.laptop === 'up') for (let i = 1; i <= 4; i++) dot(hinge, g - i, LAPTOP.lid);
		else if (frame.laptop === 'swing') {
			// a smear frame (GIF frame 13): the lid between upright and open, with a trail
			for (let i = 1; i <= 4; i++) dot(hinge - Math.floor(i / 2), g - i, LAPTOP.lid);
			for (let i = 2; i <= 4; i++) {
				dot(hinge - i + 1, g - i, LAPTOP.lid, 0.45);
				dot(hinge, g - i, LAPTOP.lid, 0.45);
			}
		} else for (let i = 0; i < 4; i++) dot(right - i, g - 1, LAPTOP.lid);
	}

	if (ch.twinkle) {
		const glint = Math.floor(t / 420) % 3 === 0;
		const tx = x0 + 6;
		const ty = y0 - 2;
		dot(tx, ty, glint ? '#efe9ff' : '#8f86d8');
		if (glint) [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([u, v]) => dot(tx + u, ty + v, '#efe9ff', 0.45));
	}

	if (frame.q) QMARK.forEach((row, y) => [...row].forEach((c, x) => c === 'B' && dot(x0 + 13 + x, Math.max(0, y0 - 5) + y, '#f2f2f6')));
	return out;
}

/** Biggest whole number of device pixels per art pixel that fits `cssWidth`. */
export function pixelScale(cssWidth, dpr = 1, cols = GRID.W) {
	return Math.max(1, Math.floor((cssWidth * dpr) / cols));
}
