/**
 * Pronunciation lab: the hard sentences, said then heard back. Each line is
 * synthesized by the wall's Phonon (current pace — no delta is sent) into
 * <mode>/NN.wav, then Parakeet transcribes the file (POST /v1/audio/transcriptions,
 * multipart file=@, model=parakeet) and the word error rate against the source
 * line is printed. <mode> is `before` or `after` the spoken lexicon
 * (../../data/voice-lexicon.json):
 *
 *   node voice-tests/pronounce/run.mjs before    # current output
 *   node voice-tests/pronounce/run.mjs after     # with the lexicon
 *
 * `after` compares against the *spoken* reference (source with the lexicon
 * applied), so an acronym spelt out on purpose counts as right, not wrong.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, applyLexicon, boxStatus, readLines, say, transcribe, wer } from '../lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] === 'after' ? 'after' : 'before';
const lexiconPath = path.join(here, '..', '..', 'data', 'voice-lexicon.json');

const lines = readLines(path.join(here, '..', 'hard_sentences.txt'));
const hasLexicon = existsSync(lexiconPath);
if (mode === 'after' && !hasLexicon) {
	console.error(`after/ needs the lexicon at ${lexiconPath} (mode before runs without it)`);
	process.exit(1);
}
if (mode === 'before' && hasLexicon) {
	console.warn(`note: ${lexiconPath} exists and the running voice box applies it — before/ is meant as the *current* output, take it before the lexicon ships or with it moved away.\n`);
}
const lexicon = mode === 'after' ? JSON.parse(readFileSync(lexiconPath, 'utf8')) : null;

const status = await boxStatus();
if (!status.up || !status.tts || !status.stt) throw new Error(`the voice box is not fully up at ${BASE}: ${JSON.stringify(status)}`);

const dir = path.join(here, '..', mode);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

console.log(`pronunciation lab (${mode}) on ${BASE} (${status.model || 'phonon'}) — ${lines.length} lines\n`);
const results = { base: BASE, model: status.model || '', mode, lexiconApplied: Boolean(lexicon), lines: [] };
let errors = 0;
let wordCount = 0;

for (const [i, source] of lines.entries()) {
	const n = String(i + 1).padStart(2, '0');
	const { wav } = await say(source);
	writeFileSync(path.join(dir, `${n}.wav`), wav);
	const heard = await transcribe(wav);
	const expected = lexicon ? applyLexicon(source, lexicon) : source;
	const r = wer(expected, heard);
	errors += r.errors;
	wordCount += r.words;
	results.lines.push({ n: i + 1, source, expected, heard, errors: r.errors, words: r.words, wer: Math.round(r.wer * 1000) / 1000 });
	console.log(`${n}  ${(r.wer * 100).toFixed(0).padStart(3)}%  ${r.errors}/${r.words}  ${source.slice(0, 72)}`);
	if (r.errors) console.log(`      heard: ${heard.slice(0, 100)}`);
}

const overall = wordCount ? errors / wordCount : 0;
results.total = { errors, words: wordCount, wer: Math.round(overall * 1000) / 1000 };
writeFileSync(path.join(dir, 'transcripts.json'), JSON.stringify(results, null, '\t') + '\n');

console.log(`\nword error rate: ${(overall * 100).toFixed(1)}%  (${errors} wrong of ${wordCount}) — transcripts in ${mode}/transcripts.json`);
const worst = results.lines.filter((l) => l.errors > 0).sort((a, b) => b.wer - a.wer || b.errors - a.errors).slice(0, 5);
if (worst.length) {
	console.log('worst lines:');
	for (const l of worst) console.log(`  #${l.n} (${(l.wer * 100).toFixed(0)}%): ${l.source.slice(0, 80)}`);
}
