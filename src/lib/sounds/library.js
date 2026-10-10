// The wall's sound library. One family: paper, brass and glass in a quiet
// room. Soft, close, never electronic, so a sound from across the room reads
// as "the wall" and not as a phone.
//
// Each entry is generated once with ElevenLabs sound effects
// (`npm run sounds:generate`) into static/sounds/<name>.mp3 and committed,
// so the kiosk never calls ElevenLabs to play a sound. A name matches a
// playChime() kind; kinds without a file (or before generation) fall back to
// the synthesized taps in src/lib/services/chime.js. The tiny, constant
// sounds (a tab tap, a swipe, volume ticks) stay synthesized on purpose:
// they need zero latency and play dozens of times a day.
//
//   prompt     what ElevenLabs is asked for
//   seconds    clip length (0.5 to 30)
//   influence  how literally to follow the prompt (0 to 1)
//   gain       playback level, 0 to 1, so the family sits at one loudness

const ROOM = 'close-miked in a quiet wooden room, dry, no music, no voice';

export const SOUND_LIBRARY = [
	{
		name: 'info',
		group: 'Notices',
		prompt: `a single soft pencil tap on thick paper, ${ROOM}`,
		seconds: 0.6,
		influence: 0.7,
		gain: 0.55
	},
	{
		name: 'ok',
		group: 'Notices',
		prompt: `two gentle rising taps on a small brass bell, very soft, ${ROOM}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.5
	},
	{
		name: 'warn',
		group: 'Notices',
		prompt: `two low muted knocks on a wooden desk, attentive but calm, ${ROOM}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'error',
		group: 'Notices',
		prompt: `a dull low thud of a closed book set down firmly on a table, ${ROOM}`,
		seconds: 0.7,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'severe',
		group: 'Notices',
		prompt: `four urgent evenly spaced strikes on a small brass ship's bell, clear and insistent, ${ROOM}`,
		seconds: 1.6,
		influence: 0.8,
		gain: 0.85
	},
	{
		name: 'success',
		group: 'Moments',
		prompt: `a quick confident pencil checkmark scratched on paper followed by a tiny glass ting, ${ROOM}`,
		seconds: 0.9,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'music',
		group: 'Moments',
		prompt: `three ascending soft taps on a wooden marimba, warm and brief, ${ROOM}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.45
	},
	{
		name: 'schedule',
		group: 'Moments',
		prompt: `a small wooden drawer sliding shut with a soft click, ${ROOM}`,
		seconds: 0.8,
		influence: 0.7,
		gain: 0.5
	},
	{
		name: 'timer',
		group: 'Moments',
		prompt: `a vintage mechanical kitchen timer bell ringing briefly, bright but gentle, ${ROOM}`,
		seconds: 1.8,
		influence: 0.75,
		gain: 0.75
	},
	{
		name: 'reminder',
		group: 'Moments',
		prompt: `a soft single strike on a small crystal glass with a short ring, ${ROOM}`,
		seconds: 1.4,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'announce',
		group: 'Voice',
		prompt: `a gentle two-note wooden chime like a small train station announcement, soft and warm, ${ROOM}`,
		seconds: 1.4,
		influence: 0.75,
		gain: 0.55
	},
	{
		name: 'morning',
		group: 'Voice',
		prompt: `a curtain sliding open on a rail followed by a soft airy glass shimmer, ${ROOM}`,
		seconds: 2.2,
		influence: 0.6,
		gain: 0.5
	},
	{
		name: 'goodnight',
		group: 'Voice',
		prompt: `a slow soft exhale of a felt piano key released, a low gentle tone fading out, ${ROOM}`,
		seconds: 2.4,
		influence: 0.6,
		gain: 0.45
	},
	{
		name: 'approval',
		group: 'Agents',
		prompt: `a polite double knock on a wooden door, soft knuckles, ${ROOM}`,
		seconds: 0.9,
		influence: 0.8,
		gain: 0.65
	},
	{
		name: 'working',
		group: 'Agents',
		prompt: `two quick mechanical typewriter key presses, light, ${ROOM}`,
		seconds: 0.6,
		influence: 0.75,
		gain: 0.45
	},
	{
		name: 'done-claude',
		group: 'Agents',
		prompt: `a fountain pen signature flourish on paper ending with a soft blotter press, ${ROOM}`,
		seconds: 1.2,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'done-cursor',
		group: 'Agents',
		prompt: `a typewriter carriage return with a small bell ding, ${ROOM}`,
		seconds: 1.2,
		influence: 0.8,
		gain: 0.55
	},
	{
		name: 'done-hermes',
		group: 'Agents',
		prompt: `a paper envelope being sealed and set down on a desk, ${ROOM}`,
		seconds: 1.2,
		influence: 0.7,
		gain: 0.6
	},
	{
		name: 'done-ollama',
		group: 'Agents',
		prompt: `a soft wooden block knock followed by a short hollow resonance, ${ROOM}`,
		seconds: 1.0,
		influence: 0.7,
		gain: 0.55
	},
	{
		name: 'install',
		group: 'System',
		prompt: `three slow soft clicks of a mechanical counter advancing, ${ROOM}`,
		seconds: 1.0,
		influence: 0.75,
		gain: 0.45
	},
	{
		name: 'update',
		group: 'System',
		prompt: `a single page of a paper notebook being turned slowly, ${ROOM}`,
		seconds: 1.0,
		influence: 0.7,
		gain: 0.5
	}
];

export const SOUND_NAMES = SOUND_LIBRARY.map((s) => s.name);

export function soundEntry(name) {
	return SOUND_LIBRARY.find((s) => s.name === name) || null;
}
