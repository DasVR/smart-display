// The wall's sound library. One family: a writer's desk with good tech on it.
// Pencils and notebooks, a softened typewriter, creamy lubed keyboard
// switches, and the soft rubber buttons and tiny haptic ticks of a small
// pocket gadget. Close, muted, rounded, never harsh or beepy, and no bells:
// nothing rings, dings or chimes. A sound from across the room reads as "the
// wall" and not as a phone.
//
// Each entry is generated once with ElevenLabs sound effects
// (`npm run sounds:generate`, or from the phone) into static/sounds/<name>.mp3,
// so the kiosk never calls ElevenLabs to play a sound. A name matches a
// playChime() kind, and every kind the wall or the phone plays is here, down
// to a tab tap and the volume slider's tick. Clips are decoded up front and
// trimmed of leading silence, so even the small ones play the instant they're
// asked for. A kind without a file (or before generation) falls back to the
// synthesized taps in src/lib/services/chime.js, in the same
// pencil-and-keycap family.
//
//   prompt     what ElevenLabs is asked for
//   seconds    clip length (0.5 to 30)
//   influence  how literally to follow the prompt (0 to 1)
//   gain       playback level, 0 to 1, so the family sits at one loudness

/** Said after every prompt, so the whole family sounds like one desk. */
export const DESK = 'close-miked on a quiet desk with a felt mat, soft and creamy, muted, dry, no reverb, no music, no voice';

/** Also said after every library prompt: ElevenLabs likes to add a ding to anything typewriter-ish. */
export const NO_BELLS = 'no bells, no chimes, no dings, no ringing';

/** A creamy switch, the family's keyboard sound. */
const CREAMY = 'a lubed linear mechanical keyboard switch with a deep muted creamy thock';

export const SOUND_LIBRARY = [
	{
		name: 'info',
		group: 'Notices',
		prompt: `a single soft pencil tap on a page of a thick paper notebook, ${DESK}, ${NO_BELLS}`,
		seconds: 0.6,
		influence: 0.7,
		gain: 0.55
	},
	{
		name: 'ok',
		group: 'Notices',
		prompt: `two quick soft keypresses on ${CREAMY}, the second slightly higher, ${DESK}, ${NO_BELLS}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.5
	},
	{
		name: 'warn',
		group: 'Notices',
		prompt: `two low muffled taps of a pencil's eraser end on a hardcover notebook cover, attentive but calm, ${DESK}, ${NO_BELLS}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'error',
		group: 'Notices',
		prompt: `a soft heavy thud of a closed hardcover notebook set down flat on a desk, ${DESK}, ${NO_BELLS}`,
		seconds: 0.7,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'severe',
		group: 'Notices',
		prompt: `four evenly spaced firm presses of a softened typewriter key, the last one heavier as the typebar strikes the paper, clear and insistent but not harsh, ${DESK}, ${NO_BELLS}`,
		seconds: 1.6,
		influence: 0.8,
		gain: 0.85
	},
	{
		name: 'success',
		group: 'Moments',
		prompt: `a quick confident pencil checkmark scratched on paper followed by one keypress on ${CREAMY}, ${DESK}, ${NO_BELLS}`,
		seconds: 0.9,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'music',
		group: 'Moments',
		prompt: `three rising soft presses of the rubber buttons on a small premium pocket gadget, each with a tiny warm haptic tick, ${DESK}, ${NO_BELLS}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.45
	},
	{
		name: 'schedule',
		group: 'Moments',
		prompt: `a notebook's elastic band snapped softly closed around its cover, ${DESK}, ${NO_BELLS}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.5
	},
	{
		name: 'timer',
		group: 'Moments',
		prompt: `a small mechanical desk timer ticking down and stopping with a soft wooden click, then two quick creamy keypresses, ${DESK}, ${NO_BELLS}`,
		seconds: 1.8,
		influence: 0.75,
		gain: 0.75
	},
	{
		name: 'reminder',
		group: 'Moments',
		prompt: `a retractable pen clicked once, then two soft taps of the pen tip on a notebook page, ${DESK}, ${NO_BELLS}`,
		seconds: 1.4,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'announce',
		group: 'Voice',
		prompt: `a small pocket voice recorder's soft button press followed by a gentle two-note haptic chirp, warm and rounded, ${DESK}, ${NO_BELLS}`,
		seconds: 1.4,
		influence: 0.75,
		gain: 0.55
	},
	{
		name: 'morning',
		group: 'Voice',
		prompt: `a paper notebook opened and its first page smoothed flat by hand, then one soft keypress on ${CREAMY}, ${DESK}, ${NO_BELLS}`,
		seconds: 2.2,
		influence: 0.6,
		gain: 0.5
	},
	{
		name: 'goodnight',
		group: 'Voice',
		prompt: `a laptop lid closing slowly with a soft magnetic click, then a pencil set down on the desk, ${DESK}, ${NO_BELLS}`,
		seconds: 2.4,
		influence: 0.6,
		gain: 0.45
	},
	{
		name: 'approval',
		group: 'Agents',
		prompt: `two polite fingertip taps on the glass screen of a small pocket device, each with a quiet soft haptic buzz, ${DESK}, ${NO_BELLS}`,
		seconds: 0.9,
		influence: 0.8,
		gain: 0.65
	},
	{
		name: 'working',
		group: 'Agents',
		prompt: `a short relaxed burst of soft typing on ${CREAMY}, ${DESK}, ${NO_BELLS}`,
		seconds: 0.6,
		influence: 0.75,
		gain: 0.45
	},
	{
		name: 'done-claude',
		group: 'Agents',
		prompt: `a fountain pen signature flourish on paper ending with the soft click of its cap, ${DESK}, ${NO_BELLS}`,
		seconds: 1.2,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'done-cursor',
		group: 'Agents',
		prompt: `a softened typewriter carriage return sliding back with a soft ratchet and a muted thunk, ${DESK}, ${NO_BELLS}`,
		seconds: 1.2,
		influence: 0.8,
		gain: 0.55
	},
	{
		name: 'done-hermes',
		group: 'Agents',
		prompt: `a page torn neatly from a spiral notebook and folded once, ${DESK}, ${NO_BELLS}`,
		seconds: 1.2,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'done-ollama',
		group: 'Agents',
		prompt: `one press of a stabilized mechanical keyboard spacebar, a deep rounded muted thock, ${DESK}, ${NO_BELLS}`,
		seconds: 1.0,
		influence: 0.7,
		gain: 0.55
	},
	{
		name: 'install',
		group: 'System',
		prompt: `three slow soft clicks of a small pocket gadget's scroll wheel advancing, ${DESK}, ${NO_BELLS}`,
		seconds: 1.0,
		influence: 0.75,
		gain: 0.45
	},
	{
		name: 'update',
		group: 'System',
		prompt: `a single notebook page turned slowly, then one quiet keypress on ${CREAMY}, ${DESK}, ${NO_BELLS}`,
		seconds: 1.0,
		influence: 0.7,
		gain: 0.5
	},
	{
		name: 'tap',
		group: 'Touch',
		prompt: `one very light quick keypress on ${CREAMY}, barely there, ${DESK}, ${NO_BELLS}`,
		seconds: 0.5,
		influence: 0.8,
		gain: 0.35
	},
	{
		name: 'swap-next',
		group: 'Touch',
		prompt: `one notebook page flicked forward quickly with a fingertip, a short soft paper swish, ${DESK}, ${NO_BELLS}`,
		seconds: 0.5,
		influence: 0.75,
		gain: 0.4
	},
	{
		name: 'swap-prev',
		group: 'Touch',
		prompt: `one notebook page flicked back quickly with a fingertip, a short soft paper swish, slightly lower, ${DESK}, ${NO_BELLS}`,
		seconds: 0.5,
		influence: 0.75,
		gain: 0.4
	},
	{
		name: 'volume',
		group: 'Touch',
		prompt: `a single tiny soft detent click of a small pocket gadget's scroll wheel, ${DESK}, ${NO_BELLS}`,
		seconds: 0.5,
		influence: 0.8,
		gain: 0.4
	},
	{
		name: 'mute',
		group: 'Touch',
		prompt: `a soft rubber button on a small pocket gadget pressed down firmly, a low muted click, ${DESK}, ${NO_BELLS}`,
		seconds: 0.5,
		influence: 0.8,
		gain: 0.45
	},
	{
		name: 'unmute',
		group: 'Touch',
		prompt: `a soft rubber button on a small pocket gadget released, a light rounded upward click, ${DESK}, ${NO_BELLS}`,
		seconds: 0.5,
		influence: 0.8,
		gain: 0.45
	}
];

export const SOUND_NAMES = SOUND_LIBRARY.map((s) => s.name);

export function soundEntry(name) {
	return SOUND_LIBRARY.find((s) => s.name === name) || null;
}
