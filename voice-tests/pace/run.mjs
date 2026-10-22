/**
 * Pace lab: say each sentence of ../sentences.txt at duration_delta
 * 0 / 0.1 / 0.2 / 0.3 (per-request pace lever, no config touched), keep the
 * WAVs under pace/<delta>/NN.wav, and print words-per-second per the
 * X-Duration-Ms the wall returns. The longest sentence is also round-tripped
 * through Parakeet at each delta, since large shifts are said to get
 * unreliable — the transcript says whether.
 *
 *   node voice-tests/pace/run.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, boxStatus, readLines, say, transcribe, words } from '../lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DELTAS = [0, 0.1, 0.2, 0.3];

const sentences = readLines(path.join(here, '..', 'sentences.txt'));
const status = await boxStatus();
if (!status.up || !status.tts || !status.stt) throw new Error(`the voice box is not fully up at ${BASE}: ${JSON.stringify(status)}`);

const results = { base: BASE, model: status.model || '', deltas: DELTAS, rows: [], heard: {} };
const totals = new Map(DELTAS.map((d) => [d, { words: 0, ms: 0 }]));
const control = sentences.reduce((a, b) => (words(b).length > words(a).length ? b : a));

console.log(`pace lab on ${BASE} (${status.model || 'phonon'}) — ${sentences.length} sentences at deltas ${DELTAS.join(' / ')}\n`);
console.log(`${'delta'.padEnd(6)} ${'#'.padEnd(3)} ${'words'.padStart(5)} ${'seconds'.padStart(8)} ${'w/s'.padStart(6)}  sentence`);

for (const delta of DELTAS) {
	const dir = path.join(here, String(delta));
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	for (const [i, text] of sentences.entries()) {
		const { wav, durationMs } = await say(text, { durationDelta: delta });
		const n = words(text).length;
		writeFileSync(path.join(dir, `${String(i + 1).padStart(2, '0')}.wav`), wav);
		results.rows.push({ delta, sentence: i + 1, words: n, durationMs, wps: Math.round((n / (durationMs / 1000)) * 100) / 100 });
		const t = totals.get(delta);
		t.words += n;
		t.ms += durationMs;
		console.log(`${String(delta).padEnd(6)} ${String(i + 1).padEnd(3)} ${String(n).padStart(5)} ${(durationMs / 1000).toFixed(2).padStart(8)} ${(n / (durationMs / 1000)).toFixed(2).padStart(6)}  ${text.slice(0, 56)}`);
	}
	const { wav } = await say(control, { durationDelta: delta });
	results.heard[String(delta)] = await transcribe(wav);
}

console.log(`\n${'delta'.padEnd(8)} ${'words/s'.padStart(8)} ${'pace vs 0'.padStart(10)}`);
for (const [d, t] of totals) {
	const wps = t.words / (t.ms / 1000);
	const base = totals.get(0);
	console.log(`${String(d).padEnd(8)} ${wps.toFixed(2).padStart(8)} ${((t.ms / (base.ms || 1)) * 100 - 100).toFixed(0).padStart(9)}%`);
}
console.log('\nreliability spot-check — Parakeet heard the longest sentence as:');
console.log(`  source: ${control}`);
for (const d of DELTAS) console.log(`  ${String(d).padEnd(5)} ${results.heard[String(d)]}`);

writeFileSync(path.join(here, 'results.json'), JSON.stringify(results, null, '\t') + '\n');
