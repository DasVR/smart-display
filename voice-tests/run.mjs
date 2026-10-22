#!/usr/bin/env node
/**
 * The voice lab's door. One command reruns it:
 *
 *   node voice-tests/run.mjs pace               the duration_delta table
 *   node voice-tests/run.mjs pronounce [mode]   before|after WER round-trip
 *   node voice-tests/run.mjs voices             the 6-voice comparison
 *   node voice-tests/run.mjs all                pace + pronounce + voices
 *
 * See README.md beside this file. Everything is local: the wall's server and
 * its real Phonon and Parakeet; nothing leaves the machine.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] || 'all';

function run(script, args = []) {
	const r = spawnSync(process.execPath, [path.join(here, script, 'run.mjs'), ...args], { stdio: 'inherit' });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

switch (cmd) {
	case 'pace':
		run('pace');
		break;
	case 'pronounce':
		run('pronounce', process.argv.slice(3));
		break;
	case 'voices':
		run('voices');
		break;
	case 'all': {
		run('pace');
		const lexicon = path.join(here, '..', 'data', 'voice-lexicon.json');
		if (existsSync(lexicon)) {
			console.error('\n[data/voice-lexicon.json exists: before/ would include it — skipping pronounce; run `node voice-tests/run.mjs pronounce before` with it moved away, or `… after` with it in place]\n');
		} else {
			run('pronounce', ['before']);
		}
		run('voices');
		console.error('\nvoice lab done.');
		break;
	}
	default:
		console.error('usage: node voice-tests/run.mjs pace|pronounce|voices|all');
		process.exit(1);
}
