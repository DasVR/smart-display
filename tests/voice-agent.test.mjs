import test from 'node:test';
import assert from 'node:assert/strict';
import {
	CANCEL_PX,
	HOLD_MS,
	cleanHeard,
	followLevel,
	joinSpeech,
	mergeResults,
	levelFromRms,
	nextPhase,
	phaseLine,
	pressEnd,
	pressMove,
	pressStart,
	pressTick,
	rmsOf,
	voiceBlocker,
	downsample,
	encodeWav,
	pauseStep,
	wantsAnswer,
	wordPulse
} from '../src/lib/voiceAgent.js';
import { parseColor } from '../src/lib/shaders/voiceOrb.js';

test('a press that ends before the hold time is a tap', () => {
	const g = pressStart(100, 700, 1000);
	assert.equal(pressTick(g, 1000 + HOLD_MS - 1).mode, 'pending');
	assert.equal(pressEnd(g, 1000 + HOLD_MS - 20).action, 'tap');
});

test('holding turns a press into a hold, and letting go sends', () => {
	let g = pressStart(100, 700, 0);
	g = pressTick(g, HOLD_MS);
	assert.equal(g.mode, 'hold');
	assert.equal(pressEnd(g, 900).action, 'send');
});

test('sliding left past the threshold cancels; coming back disarms it', () => {
	let g = pressTick(pressStart(200, 700, 0), HOLD_MS);
	g = pressMove(g, 200 - CANCEL_PX + 1);
	assert.equal(g.cancel, false);
	g = pressMove(g, 200 - CANCEL_PX);
	assert.equal(g.cancel, true);
	assert.equal(pressEnd(g, 900).action, 'cancel');
	g = pressMove(g, 190);
	assert.equal(g.cancel, false);
	assert.equal(pressEnd(g, 900).action, 'send');
});

test('a hold whose timer never fired still counts as held at release', () => {
	const g = pressStart(0, 0, 0);
	assert.equal(pressEnd(g, 400).action, 'send');
});

test('the phase machine runs listen, think, speak, rest', () => {
	let p = 'idle';
	p = nextPhase(p, 'press');
	assert.equal(p, 'listening');
	p = nextPhase(p, 'sent');
	assert.equal(p, 'thinking');
	assert.equal(nextPhase(p, 'press'), 'thinking', 'pressing while the wall thinks does not restart');
	p = nextPhase(p, 'answer');
	assert.equal(p, 'speaking');
	assert.equal(nextPhase(p, 'spoken'), 'idle');
	assert.equal(nextPhase('listening', 'spoken'), 'listening', 'a late "spoken" cannot end a new listen');
	assert.equal(nextPhase('thinking', 'fail'), 'error');
	assert.equal(nextPhase('error', 'reset'), 'idle');
});

test('the orb level rises fast and falls slowly', () => {
	const up = followLevel(0, 1, 1 / 60);
	const down = 1 - followLevel(1, 0, 1 / 60);
	assert.ok(up > down * 2, `attack ${up} should beat release ${down}`);
	assert.equal(followLevel(0.5, 2, 10) <= 1, true);
	assert.ok(Math.abs(followLevel(0.3, 0.3, 0.016) - 0.3) < 1e-9);
});

test('rms and level handle silence and speech', () => {
	assert.equal(rmsOf(new Uint8Array(0)), 0);
	assert.equal(rmsOf(new Uint8Array(64).fill(128)), 0);
	const loud = new Uint8Array(64).map((_, i) => (i % 2 ? 228 : 28));
	assert.ok(rmsOf(loud) > 0.7);
	assert.equal(levelFromRms(0), 0);
	assert.equal(levelFromRms(1), 1);
	assert.ok(levelFromRms(0.05) > 0.15, 'quiet speech still moves the orb');
});

test('each new word gives the orb a pulse', () => {
	assert.equal(wordPulse('', ''), 0);
	assert.equal(wordPulse('what', 'what is'), 0.65);
	assert.equal(wordPulse('what is', 'what is'), 0);
	assert.equal(wordPulse('a', 'a b c d e f g'), 1);
});

test('what was heard is tidied before it is sent', () => {
	assert.equal(cleanHeard('  what’s   on the wall '), 'What’s on the wall');
	assert.equal(cleanHeard('   '), '');
	assert.equal(cleanHeard(null), '');
	assert.equal(cleanHeard('Hey display, what’s the weather like tomorrow?'), 'What’s the weather like tomorrow?');
	assert.equal(cleanHeard('okay wall play some jazz'), 'Play some jazz');
	assert.equal(cleanHeard('Hey Wallace, hi'), 'Hey Wallace, hi');
	assert.equal(cleanHeard('Hey display.'), '');
});

test('an answer that ends in a question wants an answer back', () => {
	assert.equal(wantsAnswer('When should I remind you?'), true);
	assert.equal(wantsAnswer('Volume 40 percent.'), false);
});

test('voiceBlocker explains why listening cannot work, in plain words', () => {
	assert.equal(voiceBlocker({ secure: true, recognition: true }), '');
	assert.match(voiceBlocker({ secure: false, recognition: true }), /https/);
	assert.match(voiceBlocker({ secure: true, recognition: false }), /can’t listen/);
	assert.match(voiceBlocker({ secure: true, recognition: false, standalone: true }), /home screen/);
});

test('the line under the orb follows the phase', () => {
	assert.equal(phaseLine('listening', { cancel: true }), 'Release to cancel');
	assert.equal(phaseLine('listening', { hasText: true }), 'Release to send');
	assert.equal(phaseLine('listening', { latched: true }), 'Go ahead, I’m listening');
	assert.equal(phaseLine('thinking'), 'Thinking…');
	assert.equal(phaseLine('idle'), '');
	assert.equal(phaseLine('idle', { latched: true }), 'Tap the mic or type');
});

test('the orb reads its colours from the CSS tokens', () => {
	assert.deepEqual(parseColor('#fff'), [1, 1, 1]);
	const [r, g, b] = parseColor('#a9b1f0');
	assert.ok(Math.abs(r - 0.663) < 0.01 && Math.abs(g - 0.694) < 0.01 && Math.abs(b - 0.941) < 0.01);
	assert.deepEqual(parseColor('rgb(255, 0, 51)'), [1, 0, 0.2]);
	assert.deepEqual(parseColor('nonsense', [0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
});

test('cumulative recogniser results are not said twice', () => {
	// Android Chrome, continuous mode: each result holds everything so far
	assert.equal(mergeResults(["what's", "what's the", "what's the weather"]), "what's the weather");
	// separate phrases are added
	assert.equal(mergeResults(['turn it down', 'and pause']), 'turn it down and pause');
	// an exact repeat of the end is dropped
	assert.equal(mergeResults(['set a timer', 'a timer']), 'set a timer');
	assert.equal(mergeResults(['', null, '  ']), '');
	assert.equal(mergeResults(undefined), '');
});

test('speech before and after a restart joins into one sentence', () => {
	assert.equal(joinSpeech('what is', 'the weather'), 'what is the weather');
	assert.equal(joinSpeech('', 'pause'), 'pause');
	assert.equal(joinSpeech('pause', ''), 'pause');
});

test('voiceBlocker: the wall’s own ears only need the microphone', () => {
	assert.equal(voiceBlocker({ secure: true, recognition: false, wallEars: true }), '');
	assert.match(voiceBlocker({ secure: false, recognition: true, wallEars: true }), /https/);
});

test('downsample averages 48 kHz down to the 16 kHz the wall hears', () => {
	const out = downsample(Float32Array.from([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]), 48000);
	assert.equal(out.length, 2);
	assert.ok(Math.abs(out[0] - 0.3) < 1e-6 && Math.abs(out[1] - 0.6) < 1e-6);
	assert.equal(downsample(Float32Array.from([0.1, 0.2]), 16000).length, 2);
});

test('encodeWav writes a 16-bit mono PCM WAV', () => {
	const wav = encodeWav(Float32Array.from([0, 0.5, -1, 2]), 16000);
	const v = new DataView(wav.buffer);
	assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
	assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
	assert.equal(v.getUint32(24, true), 16000);
	assert.equal(v.getUint16(34, true), 16);
	assert.equal(v.getUint32(40, true), 8);
	assert.equal(wav.length, 52);
	assert.equal(v.getInt16(46, true), Math.trunc(0.5 * 0x7fff));
	assert.equal(v.getInt16(48, true), -0x8000);
	assert.equal(v.getInt16(50, true), 0x7fff); // clipped, not wrapped
});

test('pauseStep: a pause only ends a sentence once someone has spoken', () => {
	let s = null;
	for (let i = 0; i < 30; i++) s = pauseStep(s, 0.02, 100);
	assert.equal(s.done, false, 'silence before speaking never ends it');
	s = pauseStep(s, 0.5, 100);
	for (let i = 0; i < 20; i++) s = pauseStep(s, 0.02, 100);
	assert.equal(s.done, false, 'a click is not speech');
	for (let i = 0; i < 5; i++) s = pauseStep(s, 0.5, 100);
	for (let i = 0; i < 12; i++) s = pauseStep(s, 0.02, 100);
	assert.equal(s.done, false);
	for (let i = 0; i < 2; i++) s = pauseStep(s, 0.02, 100);
	assert.equal(s.done, true);
	assert.equal(pauseStep(s, 0.5, 100).done, false, 'talking again starts over');
});
