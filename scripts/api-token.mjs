#!/usr/bin/env node
/**
 * Lock the tasks API: mint a bearer token into data/api-token (mode 600).
 *   npm run api-token          mint (or replace) the token and print it
 *   npm run api-token -- --off remove it; the API is open to the LAN again
 * The server re-reads the file on every request, so no restart is needed.
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintApiToken } from '../src/lib/server/taskService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'api-token');

if (process.argv.includes('--off')) {
	if (existsSync(file)) rmSync(file);
	console.log('Token removed. /api/tasks is open to the LAN again.');
} else {
	const token = mintApiToken(file);
	console.log(`Token written to ${file}\n\n  Authorization: Bearer ${token}\n`);
	console.log('Give that header to each platform that should reach /api/tasks.');
}
