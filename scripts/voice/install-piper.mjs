#!/usr/bin/env node
/**
 * Fetch free Piper voices for the wall (docs/voice.md).
 *   npm run voice:piper                       the three voices below (~65 MB each)
 *   npm run voice:piper -- en_US-ryan-high    any voice sherpa-onnx packages
 *
 * They go to ~/.cache/wall-voice (PIPER_VOICES_DIR overrides), where the
 * server finds them; no restart needed. List of voices:
 * https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models (vits-piper-*).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { piperVoicesDir, voiceLabel } from '../../src/lib/server/piperVoice.js';

const DEFAULT_VOICES = ['en_US-lessac-medium', 'en_US-amy-medium', 'en_GB-alan-medium'];
const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const voices = wanted.length ? wanted : DEFAULT_VOICES;
const dir = piperVoicesDir();
mkdirSync(dir, { recursive: true });

let failed = 0;
for (const name of voices) {
	if (!/^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-(?:x_low|low|medium|high)$/.test(name)) {
		console.error(`skipping "${name}": voice names look like en_US-lessac-medium`);
		failed += 1;
		continue;
	}
	const folder = `vits-piper-${name}`;
	if (existsSync(path.join(dir, folder, `${name}.onnx`))) {
		console.log(`have ${voiceLabel(name)}`);
		continue;
	}
	const tar = path.join(dir, `${folder}.tar.bz2`);
	try {
		console.log(`fetching ${voiceLabel(name)} (${name})`);
		execFileSync('curl', ['-fL', '--progress-bar', `${BASE}/${folder}.tar.bz2`, '-o', tar], { stdio: 'inherit' });
		execFileSync('tar', ['-xjf', tar, '-C', dir], { stdio: 'inherit' });
	} catch {
		console.error(`could not fetch ${name}`);
		failed += 1;
	} finally {
		rmSync(tar, { force: true });
	}
}
console.log(`\nvoices in ${dir}. On the phone: Home → Sounds & voice → Voice.`);
process.exit(failed ? 1 : 0);
