#!/usr/bin/env node
// Generates the wall's sound library with ElevenLabs sound effects, once.
// The mp3s land in static/sounds/ and are meant to be committed, so the
// kiosk never calls ElevenLabs just to play a sound.
//
//   npm run sounds:generate                  make every sound that's missing
//   npm run sounds:generate -- --only timer  just these (comma-separated)
//   npm run sounds:generate -- --force       remake them even if they exist
//   npm run sounds:generate -- --takes 3     make 3 takes of each into
//                                            static/sounds/takes/ to audition;
//                                            copy the one you like over the
//                                            original, then delete takes/
//
// The key comes from ELEVENLABS_API_KEY or data/elevenlabs-key. It is never
// printed. Each clip costs credits roughly in proportion to its length.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_LIBRARY } from '../src/lib/sounds/library.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'static', 'sounds');
const API = 'https://api.elevenlabs.io/v1/sound-generation';

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	if (i === -1) return null;
	const v = process.argv[i + 1];
	return v && !v.startsWith('--') ? v : true;
}

function apiKey() {
	const env = String(process.env.ELEVENLABS_API_KEY || '').trim();
	if (env) return env;
	const file = path.join(ROOT, 'data', 'elevenlabs-key');
	return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/** static/sounds/index.json: which names have a file, and how loud to play them. */
export function writeIndex(dir = OUT) {
	mkdirSync(dir, { recursive: true });
	const have = new Set(readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)));
	const sounds = {};
	for (const s of SOUND_LIBRARY) if (have.has(s.name)) sounds[s.name] = { gain: s.gain };
	writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({ sounds }, null, '\t')}\n`);
	return Object.keys(sounds);
}

async function generate(key, entry) {
	const res = await fetch(API, {
		method: 'POST',
		headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
		body: JSON.stringify({
			text: entry.prompt,
			duration_seconds: entry.seconds,
			prompt_influence: entry.influence
		}),
		signal: AbortSignal.timeout(60000)
	});
	if (!res.ok) {
		const reason = (await res.text().catch(() => '')).slice(0, 200);
		throw new Error(`ElevenLabs answered ${res.status} ${reason}`);
	}
	return Buffer.from(await res.arrayBuffer());
}

async function main() {
	const only = arg('only');
	const force = Boolean(arg('force'));
	const takes = Math.max(1, Math.min(5, Number(arg('takes')) || 1));
	const wanted = typeof only === 'string' ? new Set(only.split(',').map((s) => s.trim())) : null;
	const list = SOUND_LIBRARY.filter((s) => !wanted || wanted.has(s.name));
	if (wanted) {
		const unknown = [...wanted].filter((n) => !SOUND_LIBRARY.some((s) => s.name === n));
		if (unknown.length) {
			console.error(`Unknown sound: ${unknown.join(', ')}. See src/lib/sounds/library.js.`);
			process.exit(1);
		}
	}
	const key = apiKey();
	if (!key) {
		console.error('No ElevenLabs key. Put it in data/elevenlabs-key (gitignored) or ELEVENLABS_API_KEY.');
		process.exit(1);
	}
	mkdirSync(OUT, { recursive: true });
	let made = 0;
	for (const entry of list) {
		if (takes > 1) {
			const dir = path.join(OUT, 'takes');
			mkdirSync(dir, { recursive: true });
			for (let t = 1; t <= takes; t++) {
				writeFileSync(path.join(dir, `${entry.name}-${t}.mp3`), await generate(key, entry));
				made++;
			}
			console.log(`${entry.name}: ${takes} takes in static/sounds/takes/`);
			continue;
		}
		const file = path.join(OUT, `${entry.name}.mp3`);
		if (existsSync(file) && !force) {
			console.log(`${entry.name}: already there`);
			continue;
		}
		writeFileSync(file, await generate(key, entry));
		made++;
		console.log(`${entry.name}: made (${entry.seconds}s)`);
	}
	const have = writeIndex();
	console.log(`\n${made} generated. ${have.length} of ${SOUND_LIBRARY.length} sounds in the library.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main().catch((err) => {
		console.error(err.message);
		process.exit(1);
	});
}
