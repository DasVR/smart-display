import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.join(process.cwd(), 'scripts/forced_align/install-host-venv.sh');

test('install-host-venv.sh --dry-run uses the CPU torch index and pins numpy<2', () => {
	const result = spawnSync('bash', [SCRIPT, '--dry-run'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /download\.pytorch\.org\/whl\/cpu/);
	assert.match(result.stdout, /numpy<2/);
	assert.match(result.stdout, /\bwhisperx\b/);
	assert.match(result.stdout, /\bdemucs\b/);
	assert.match(result.stdout, /\bsyncedlyrics\b/);
	assert.match(result.stdout, /\bffmpeg\b/);
	assert.doesNotMatch(result.stdout, /lyricsgenius/);
	assert.doesNotMatch(result.stdout, /pip install whisperx$/m);
});

test('install-host-venv.sh refuses the Cursor Cloud pod without LYRIX_ALLOW_CLOUD', () => {
	const result = spawnSync('bash', [SCRIPT], {
		encoding: 'utf8',
		env: { ...process.env, LYRIX_ALLOW_CLOUD: '0' }
	});
	assert.equal(result.status, 1, result.stderr || result.stdout);
	assert.match(result.stderr, /Cursor Cloud pod/);
	assert.match(result.stderr, /das-server/);
});
