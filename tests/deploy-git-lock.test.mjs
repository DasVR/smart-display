import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

	it('sources the helper from the Actions checkout when the kiosk tree has no scripts/lib', () => {
		const text = readFileSync(deploy, 'utf8');
		const scriptDirAt = text.indexOf('SCRIPT_DIR=');
		const sourceAt = text.indexOf('. "$SCRIPT_DIR/lib/git-index-lock.sh"');
		const cdAt = text.indexOf('cd "$PROJECT_DIR"');
		assert.ok(scriptDirAt >= 0, 'SCRIPT_DIR must be set');
		assert.ok(sourceAt > scriptDirAt, 'helper must be sourced from SCRIPT_DIR');
		assert.ok(cdAt > sourceAt, 'cd into the kiosk tree must happen after sourcing');

		const workspace = mkdtempSync(join(tmpdir(), 'deploy-ws-'));
		const kiosk = mkdtempSync(join(tmpdir(), 'deploy-kiosk-'));
		const stubs = mkdtempSync(join(tmpdir(), 'deploy-stubs-'));
		const lock = join(mkdtempSync(join(tmpdir(), 'deploy-lockfile-')), 'kiosk.lock');
		try {
			mkdirSync(join(workspace, 'scripts/lib'), { recursive: true });
			copyFileSync(deploy, join(workspace, 'scripts/deploy.sh'));
			copyFileSync(helper, join(workspace, 'scripts/lib/git-index-lock.sh'));
			mkdirSync(join(kiosk, 'scripts'));
			writeFileSync(
				join(stubs, 'git'),
				'#!/bin/bash\ncmd="${1:-}"\ncase "$cmd" in\nrev-parse) echo testdeploysha ;;\nlog) echo test-deploy ;;\n*) exit 0 ;;\nesac\n',
				{ mode: 0o755 }
			);
			for (const name of ['npm', 'sudo', 'systemctl', 'curl']) {
				writeFileSync(join(stubs, name), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
			}
			const out = execFileSync('bash', ['./scripts/deploy.sh'], {
				cwd: workspace,
				encoding: 'utf8',
				env: {
					PATH: `${stubs}:${process.env.PATH || '/usr/bin:/bin'}`,
					SMART_DISPLAY_DIR: kiosk,
					SMART_DISPLAY_LOCK: lock,
					SMART_DISPLAY_NPM: join(stubs, 'npm'),
					HOME: process.env.HOME || '/tmp',
					LANG: 'C'
				}
			});
			assert.match(out, /=== smart-display deploy ===/);
			assert.match(out, /=== deploy complete ===/);
			assert.doesNotMatch(out, /git-index-lock\.sh: No such file/);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(kiosk, { recursive: true, force: true });
			rmSync(stubs, { recursive: true, force: true });
			rmSync(dirname(lock), { recursive: true, force: true });
		}
	});
});
