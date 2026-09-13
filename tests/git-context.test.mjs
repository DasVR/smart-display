import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseGitAheadBehind } from '../src/lib/server/hostData.js';

test('parseGitAheadBehind reads behind-only tracking', () => {
	assert.deepEqual(parseGitAheadBehind('## master...origin/master [behind 2]'), {
		ahead: 0,
		behind: 2
	});
});

test('parseGitAheadBehind reads ahead and behind together', () => {
	assert.deepEqual(parseGitAheadBehind('## master...origin/master [ahead 1, behind 3]'), {
		ahead: 1,
		behind: 3
	});
});

test('parseGitAheadBehind is zero when there is no upstream marker', () => {
	assert.deepEqual(parseGitAheadBehind('## master'), { ahead: 0, behind: 0 });
	assert.deepEqual(parseGitAheadBehind(''), { ahead: 0, behind: 0 });
});
