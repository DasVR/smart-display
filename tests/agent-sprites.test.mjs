import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, F, GRID, STATES, blink, characterFor, crouch, framesFor, look, mix, pathTo, pixelScale, renderFrame } from '../src/lib/agentSprites.js';

const POSES = ['stand', 'windup', 'stretch', 'sit', 'slump'];

test('every character has the five poses, 12 pixels wide, with every colour in its palette', () => {
	for (const [id, ch] of Object.entries(CHARACTERS)) {
		for (const name of POSES) {
			const pose = ch.poses[name];
			assert.ok(pose, `${id}.${name}`);
			for (const row of pose) {
				assert.equal(row.length, 12, `${id}.${name}: "${row}"`);
				for (const c of row) assert.ok(c === '.' || c === 'C' || ch.palette[c], `${id}.${name}: no colour for "${c}"`);
			}
			assert.ok(pose.length <= GRID.GROUND - 1, `${id}.${name} fits under the hop room`);
		}
		const [hx, hy] = ch.hand;
		assert.ok(ch.poses.sit[hy]?.[hx] && ch.poses.sit[hy][hx] !== '.', `${id}: the typing hand is on the body`);
	}
});

test('Clawd is the GIF’s 12 × 8 front pose', () => {
	assert.deepEqual(CHARACTERS.claude.poses.stand, [
		'..BBBBBBBB..',
		'..BEBBBBEB..',
		'BBBBBBBBBBBB',
		'BBBBBBBBBBBB',
		'..BBBBBBBB..',
		'..BBBBBBBB..',
		'..B.B..B.B..',
		'..B.B..B.B..'
	]);
	assert.equal(CHARACTERS.claude.palette.B, '#d06a4b');
	assert.equal(CHARACTERS.claude.palette.D, '#b55c41');
});

test('every state plays for every character, in whole GIF frames', () => {
	for (const id of Object.keys(CHARACTERS)) {
		for (const [state, s] of Object.entries(STATES)) {
			const frames = framesFor(id, state);
			assert.ok(frames.length, `${id}.${state}`);
			for (const f of frames) {
				assert.equal(f.ms % F, 0, `${id}.${state}.${f.name}: ${f.ms} ms`);
				assert.ok(f.ms >= F, 'no frame shorter than one GIF frame');
				assert.ok(renderFrame(id, f, 0).length > 20, `${id}.${state}.${f.name} draws`);
			}
			assert.equal(typeof s.loop, 'boolean');
		}
	}
	assert.deepEqual(framesFor('nobody', 'work'), []);
	assert.deepEqual(framesFor('claude', 'dance'), []);
});

test('pose edits: blink, look, crouch', () => {
	const stand = CHARACTERS.claude.poses.stand;
	assert.equal(blink(stand)[1], '..BBBBBBBB..');
	assert.equal(look(-1)(stand)[1], '..EBBBBEBB..');
	assert.equal(look(1)(stand)[1], '..BBEBBBBE..');
	assert.equal(crouch(stand).length, 7);
	// Cursor's caret isn't an eye: a blink leaves it
	assert.match(blink(CHARACTERS.cursor.poses.stand)[2], /C/);
});

test('renderFrame stands the sprite on the ground and paints half-tones between colours', () => {
	const stand = CHARACTERS.claude.poses.stand;
	const px = renderFrame('claude', { pose: stand });
	const feet = Math.max(...px.map((p) => p.y));
	assert.equal(feet, GRID.GROUND - 1);
	assert.equal(Math.min(...px.map((p) => p.x)), GRID.OX);
	const eye = px.find((p) => p.x === GRID.OX + 3 && p.y === GRID.GROUND - 8 + 1);
	assert.equal(eye.color, '#0c0c0c');
	const halfEye = renderFrame('claude', { pose: stand, half: [[3, 1]] }).find((p) => p.x === eye.x && p.y === eye.y);
	assert.equal(halfEye.color, mix('#d06a4b', '#0c0c0c'), 'a half-shut eye is halfway to its lid');
	const hop = renderFrame('claude', { pose: stand, dy: -2 });
	assert.equal(Math.max(...hop.map((p) => p.y)), GRID.GROUND - 3);
});

test('typing lifts the near arm; a half keystroke fades it', () => {
	const sit = CHARACTERS.claude.poses.sit;
	const [hx, hy] = CHARACTERS.claude.hand;
	const y = GRID.GROUND - sit.length + hy;
	const at = (frame) => renderFrame('claude', frame).find((p) => p.x === GRID.OX + hx && p.y === y);
	assert.equal(at({ pose: sit }).color, '#d06a4b');
	assert.equal(at({ pose: sit, type: 1 }), undefined);
	assert.equal(at({ pose: sit, typeHalf: 1 }).color, mix('#d06a4b', '#0c0c0c'));
});

test('the laptop: open, upright, shut and a smear between', () => {
	const sit = CHARACTERS.claude.poses.sit;
	const grey = (frame) => renderFrame('claude', frame).filter((p) => p.color === '#8c8c8c' || p.color === '#a6a6a6');
	assert.equal(grey({ pose: sit }).length, 0);
	assert.equal(grey({ pose: sit, laptop: 'open' }).length, 8);
	assert.equal(grey({ pose: sit, laptop: 'shut' }).length, 8);
	assert.ok(grey({ pose: sit, laptop: 'swing' }).some((p) => p.alpha === 0.45), 'the smear has a trail');
	const lid = grey({ pose: sit, laptop: 'up' }).filter((p) => p.color === '#a6a6a6');
	assert.equal(new Set(lid.map((p) => p.x)).size, 1, 'upright lid is one column');
});

test('Cursor’s caret blinks on its own clock; Gemini’s twinkle glints', () => {
	const stand = CHARACTERS.cursor.poses.stand;
	const caret = (t) => renderFrame('cursor', { pose: stand }, t).find((p) => p.x === GRID.OX + 8 && p.y === GRID.GROUND - 9 + 2).color;
	assert.equal(caret(0), '#0b0b10');
	assert.equal(caret(600), '#c9cbd4');
	const glints = (t) => renderFrame('gemini', { pose: CHARACTERS.gemini.poses.stand }, t).filter((p) => p.alpha).length;
	assert.equal(glints(0), 4);
	assert.equal(glints(500), 0);
});

test('Hermes’s wing tips beat by colour on their own clock', () => {
	const stand = CHARACTERS.hermes.poses.stand;
	const tips = (t) => renderFrame('hermes', { pose: stand }, t).filter((p) => p.y === GRID.GROUND - stand.length).map((p) => p.color);
	assert.deepEqual(tips(0), [CHARACTERS.hermes.palette.X, CHARACTERS.hermes.palette.X]);
	assert.deepEqual(tips(400), [mix(CHARACTERS.hermes.palette.X, '#0c0c0c'), mix(CHARACTERS.hermes.palette.X, '#0c0c0c')]);
});

test('characterFor maps agent names to characters', () => {
	assert.equal(characterFor('Claude Code'), 'claude');
	assert.equal(characterFor('claude'), 'claude');
	assert.equal(characterFor('Cursor'), 'cursor');
	assert.equal(characterFor('Gemini CLI'), 'gemini');
	assert.equal(characterFor('Hermes'), 'hermes');
	assert.equal(characterFor('hermes-agent'), 'hermes');
	assert.equal(characterFor('Ollama'), null);
	assert.equal(characterFor(''), null);
});

test('pathTo shuts or opens the laptop between sitting and standing', () => {
	assert.deepEqual(pathTo('work', 'ask'), ['close', 'ask']);
	assert.deepEqual(pathTo('open', 'idle'), ['close', 'idle']);
	assert.deepEqual(pathTo('ask', 'work'), ['open', 'work']);
	assert.deepEqual(pathTo('yes', 'work'), ['open', 'work']);
	assert.deepEqual(pathTo('ask', 'yes'), ['yes']);
	assert.deepEqual(pathTo('work', 'work'), ['work']);
});

test('pixelScale keeps every art pixel a whole number of device pixels', () => {
	assert.equal(pixelScale(440, 1), 20);
	assert.equal(pixelScale(440, 2), 40);
	assert.equal(pixelScale(100, 1.5), 6);
	assert.equal(pixelScale(5, 1), 1, 'never zero');
});
