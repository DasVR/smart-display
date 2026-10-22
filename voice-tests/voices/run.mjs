/**
 * Voice lab: document Phonon's English voices from the catalog JSONL and say
 * the same 5 sentences in 6 of them (voices/<Name>/NN.wav). The catalog is
 * the one the voice box loaded (VOICE_TEST_VOICES to point elsewhere).
 *
 *   node voice-tests/voices/run.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, boxStatus, readLines, say, words } from '../lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// a spread of the catalog: the default, then US and GB, female and male, young and settled
const PICK = ['Easton', 'Harper', 'Juniper', 'Micah', 'Maeve', 'Edwin'];

const catalogPath = process.env.VOICE_TEST_VOICES || path.join(os.homedir(), '.cache', 'wall-senses', 'phonon-voices', 'voices.jsonl');
const dir = path.dirname(catalogPath);
const catalog = [];
for (const line of readFileSync(catalogPath, 'utf8').split('\n')) {
	try {
		const v = JSON.parse(line);
		if (v.name && (v.language || 'en') === 'en' && existsSync(path.join(dir, v.filename || ''))) catalog.push(v);
	} catch {
		/* not json */
	}
}

console.log(`${catalog.length} English voices in ${catalogPath}\n`);
const byLocale = new Map();
for (const v of catalog) {
	const list = byLocale.get(v.locale) || [];
	list.push(v);
	byLocale.set(v.locale, list);
}
for (const [locale, list] of [...byLocale].sort()) {
	console.log(`${locale} (${list.length}):`);
	for (const v of list) console.log(`  ${String(v.name).padEnd(13)} ${String(v.gender).padEnd(7)} ${String(v.age).padEnd(13)} ${v.description}`);
}

const status = await boxStatus();
if (!status.up || !status.tts) throw new Error(`the voice box is not up at ${BASE}: ${JSON.stringify(status)}`);
const sentences = readLines(path.join(here, '..', 'sentences.txt')).slice(0, 5);
const picked = PICK.filter((n) => catalog.some((v) => v.name === n));
if (picked.length !== PICK.length) console.warn(`\nnote: not in the catalog: ${PICK.filter((n) => !picked.includes(n)).join(', ')}`);

console.log(`\nsaying ${sentences.length} sentences in ${picked.join(', ')}:`);
for (const name of picked) {
	const d = path.join(here, name);
	rmSync(d, { recursive: true, force: true });
	mkdirSync(d, { recursive: true });
	let ms = 0;
	let nWords = 0;
	for (const [i, text] of sentences.entries()) {
		const out = await say(text, { voice: name });
		writeFileSync(path.join(d, `${String(i + 1).padStart(2, '0')}.wav`), out.wav);
		ms += out.durationMs;
		nWords += words(text).length;
	}
	console.log(`  ${name.padEnd(13)} ${(nWords / (ms / 1000)).toFixed(2)} words/s over ${sentences.length} sentences`);
}
