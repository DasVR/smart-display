import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(process.cwd(), 'scripts/forced_align/install-host-venv.sh');

function dryRun(env = {}) {
	return spawnSync('bash', [SCRIPT, '--dry-run'], {
		encoding: 'utf8',
		env: { ...process.env, ...env }
	});
}

function writeStub(dir, name, version) {
	const file = path.join(dir, name);
	writeFileSync(
		file,
		`#!/bin/sh
if [ "$1" = "-c" ]; then
	echo "${version}"
	exit 0
fi
echo "${name} ${version}"
`
	);
	chmodSync(file, 0o755);
	return file;
}

test('install-host-venv.sh --dry-run uses CPU torch 2.8 and whisperx 3.7+ without numpy<2', () => {
	const result = dryRun();
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /download\.pytorch\.org\/whl\/cpu/);
	assert.match(result.stdout, /torch==2\.8\.0/);
	assert.match(result.stdout, /whisperx>=3\.7,<4/);
	assert.match(result.stdout, /\bdemucs\b/);
	assert.match(result.stdout, /\bsyncedlyrics\b/);
	assert.match(result.stdout, /\bffmpeg\b/);
	assert.match(result.stdout, /python3\.12 -m venv|python3(\.\d+)? -m venv/);
	assert.doesNotMatch(result.stdout, /numpy<2/);
	assert.doesNotMatch(result.stdout, /ctranslate2==4\.4\.0/);
	assert.doesNotMatch(result.stdout, /lyricsgenius/);
	assert.doesNotMatch(result.stdout, /pip install whisperx$/m);
});

test('install-host-venv.sh --help mentions recreate and Python 3.12', () => {
	const result = spawnSync('bash', [SCRIPT, '--help'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /--recreate/);
	assert.match(result.stdout, /3\.12/);
	assert.match(result.stdout, /3\.14/);
	assert.doesNotMatch(result.stdout, /pip install ["']numpy<2/);
});

test('install-host-venv.sh --dry-run prefers python3.12 over python3.14', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'lyrix-py-'));
	writeStub(dir, 'python3.14', '3.14');
	writeStub(dir, 'python3.12', '3.12');
	writeStub(dir, 'python3', '3.14');
	const result = dryRun({ PATH: `${dir}:${process.env.PATH}` });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /python: .*python3\.12/);
	assert.doesNotMatch(result.stdout, /python: .*python3\.14/);
	assert.match(result.stdout, /python3\.12 -m venv/);
});

test('install-host-venv.sh --dry-run does not pick a 3.14-only PATH', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'lyrix-py14-'));
	for (const name of ['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3']) {
		writeStub(dir, name, '3.14');
	}
	const result = dryRun({ PATH: `${dir}:${process.env.PATH}` });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /MISSING \(need 3\.10-3\.13, not 3\.14\)/);
	assert.match(result.stdout, /python3\.12 -m venv/);
	assert.doesNotMatch(result.stdout, /python3\.14 -m venv/);
});

test('install-host-venv.sh refuses the Cursor Cloud pod without LYRIX_ALLOW_CLOUD', () => {
	const result = spawnSync('bash', [SCRIPT], {
		encoding: 'utf8',
		env: { ...process.env, LYRIX_ALLOW_CLOUD: '0' }
	});
	assert.equal(result.status, 1, result.stderr || result.stdout);
	assert.match(result.stderr, /Cursor Cloud pod/);
	assert.match(result.stderr, /das-server/);
	assert.match(result.stderr, /install-host-venv\.sh --apply-systemd --recreate/);
});
