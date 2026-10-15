#!/usr/bin/env node
// How long the wall took to come on (docs/boot.md): the last boot stage by
// stage from the wall's own marks (GET /api/boot), then systemd's view of the
// same boot when it's there.  npm run boot-report [-- http://wall:3000]

import { execFileSync } from 'node:child_process';
import { describeBoot, seconds } from '../../src/lib/bootTimeline.js';

const wall = (process.argv[2] || process.env.WALL_URL || 'http://localhost:3000').replace(/\/+$/, '');

function systemd(args) {
	try {
		return execFileSync('systemd-analyze', args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

let boots = [];
try {
	boots = (await (await fetch(`${wall}/api/boot`, { signal: AbortSignal.timeout(5000) })).json()).boots || [];
} catch (e) {
	console.log(`Couldn't ask ${wall} (${e.cause?.code || e.message}).`);
}
const last = boots.find((b) => b.kind === 'boot');
if (last) {
	console.log(`Last boot (${new Date(last.at).toLocaleString()}):\n`);
	for (const line of describeBoot(last)) console.log(`  ${line}`);
} else if (boots.length) {
	console.log('No boot from power on recorded yet, only page reloads. Reboot the wall and run this again.');
} else {
	console.log('No boots recorded yet. Reboot the wall (with this version) and run this again.');
}
const totals = boots.filter((b) => b.kind === 'boot' && b.power && b.awake).map((b) => seconds(b.awake - b.power));
if (totals.length > 1) console.log(`\nRecent boots, power on to awake: ${totals.join(', ')}`);

const summary = systemd([]);
if (summary) {
	console.log(`\nsystemd: ${summary.split('\n')[0]}`);
	const chain = systemd(['critical-chain', 'smart-display-kiosk.service']);
	if (chain) console.log(`\nWhat the kiosk waited for:\n${chain.split('\n').slice(2).join('\n')}`);
	const blame = systemd(['blame']);
	if (blame) console.log(`\nSlowest to start:\n${blame.split('\n').slice(0, 8).join('\n')}`);
}
