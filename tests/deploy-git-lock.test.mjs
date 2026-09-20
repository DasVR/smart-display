import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const helper = join(root, 'scripts/lib/git-index-lock.sh');
const deploy = join(root, 'scripts/deploy.sh');

describe('git index lock', () => {
	it('parses deploy.sh', () => {
		execFileSync('bash', ['-n', deploy]);
	});

	it('removes a leftover index.lock after the wait', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deploy-lock-'));
		try {
			mkdirSync(join(dir, '.git'));
			const lock = join(dir, '.git/index.lock');
			writeFileSync(lock, '');
			execFileSync(
				'bash',
				[
					'-ceu',
					`. "$1"; cd "$2"; GIT_INDEX_LOCK_WAIT=1 wait_and_clear_index_lock`,
					'lock-test',
					helper,
					dir
				],
				{ env: { ...process.env, GIT_INDEX_LOCK_WAIT: '1' } }
			);
			assert.equal(existsSync(lock), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('is a no-op when no lock file is present', () => {
		const dir = mkdtempSync(join(tmpdir(), 'deploy-lock-'));
		try {
			mkdirSync(join(dir, '.git'));
			execFileSync('bash', [
				'-ceu',
				`. "$1"; cd "$2"; GIT_INDEX_LOCK_WAIT=1 wait_and_clear_index_lock`,
				'lock-test',
				helper,
				dir
			]);
			assert.equal(existsSync(join(dir, '.git/index.lock')), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
