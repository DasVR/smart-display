import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PY = process.env.LYRICS_PYTHON_BIN || 'python3';
const COMMUNITY = path.join(process.cwd(), 'scripts/forced_align/community_lyrics.py');
const CANONICAL = path.join(process.cwd(), 'scripts/forced_align/canonical_lyrics.py');
const ALIGN = path.join(process.cwd(), 'scripts/forced_align/align.py');

function runPython(args, extra = {}) {
	return spawnSync(PY, args, { encoding: 'utf8', timeout: 15000, ...extra });
}

test('community_lyrics.py --self-test', () => {
	const result = runPython([COMMUNITY, '--self-test']);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const parsed = JSON.parse(result.stdout);
	assert.equal(parsed.ok, true);
});

test('canonical_lyrics.py --self-test', () => {
	const result = runPython([CANONICAL, '--self-test']);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const parsed = JSON.parse(result.stdout);
	assert.equal(parsed.ok, true);
});

test('align.py --self-test', () => {
	const result = runPython([ALIGN, '--self-test']);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.equal(JSON.parse(result.stdout).ok, true);
	assert.equal(JSON.parse(result.stdout).tests, 15);
});

test('align.py --probe always lists the stdlib energy engine and says whether the pick is precise', () => {
	const result = runPython([ALIGN, '--probe'], { env: { ...process.env, FORCED_ALIGN_ENGINE: 'auto' } });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const parsed = JSON.parse(result.stdout);
	assert.ok(parsed.available.includes('energy'));
	assert.equal(typeof parsed.precise, 'boolean');
	assert.equal(parsed.precise, ['whisperx', 'qwen', 'ctc', 'aeneas', 'mfa'].includes(parsed.engine));
	assert.ok(parsed.python);
	if (parsed.engine === 'whisperx') {
		assert.equal(parsed.whisper_model, 'large-v3');
		assert.ok(parsed.align_model);
	}
	const forced = runPython([ALIGN, '--probe'], { env: { ...process.env, FORCED_ALIGN_ENGINE: 'energy' } });
	const forcedParsed = JSON.parse(forced.stdout);
	assert.equal(forcedParsed.engine, 'energy');
	assert.equal(forcedParsed.precise, false);
});

test('align.py energy engine writes word clocks from a silent-then-loud wav', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'align-energy-'));
	const wavPath = path.join(dir, 'track.wav');
	const lyricsPath = path.join(dir, 'lyrics.txt');
	const outPath = path.join(dir, 'out.json');
	writeFileSync(lyricsPath, 'hello there\nsecond line\n');
	const gen = runPython([
		'-c',
		`
import math, struct, wave, sys
path = sys.argv[1]
rate = 8000
n = rate * 2
with wave.open(path, 'w') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    for i in range(n):
        # quiet first 0.4s, then a tone
        amp = 0 if i < rate * 0.4 else 0.4
        sample = int(amp * 32767 * math.sin(2 * math.pi * 440 * i / rate))
        w.writeframes(struct.pack('<h', sample))
`,
		wavPath
	]);
	assert.equal(gen.status, 0, gen.stderr);
	const result = runPython([ALIGN, wavPath, lyricsPath, outPath], { env: { ...process.env, FORCED_ALIGN_ENGINE: 'energy' } });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const data = JSON.parse(readFileSync(outPath, 'utf8'));
	assert.equal(data.engine, 'energy');
	assert.equal(data.precise, false);
	assert.ok(data.lines.length >= 2);
	assert.ok(data.lines[0].words.length >= 2);
	assert.ok(data.lines[0].words[0].time < data.lines[1].time);
	// Words land where the tone starts (0.4s), not in the quiet intro.
	assert.ok(data.lines[0].words[0].time >= 0.3, `first word at ${data.lines[0].words[0].time}`);
	assert.ok(data.lines[0].words[0].end > data.lines[0].words[0].time, 'energy engine now emits word ends');
});
