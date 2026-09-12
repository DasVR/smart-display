#!/usr/bin/env node
import { execSync } from 'node:child_process';

import {
	formatSpeakerReport,
	parseWpctlStatus,
	pickSpeakerSink
} from '../src/lib/server/audioSinks.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const beep = args.has('--beep');

function run(cmd, opts = {}) {
	return execSync(cmd, { encoding: 'utf8', timeout: opts.timeout ?? 8000, stdio: opts.stdio ?? 'pipe' });
}

let statusText = '';
try {
	statusText = run('wpctl status');
} catch {
	console.error('wpctl is not available. Is PipeWire / WirePlumber running?');
	process.exit(1);
}

const sinks = parseWpctlStatus(statusText);
const pick = pickSpeakerSink(sinks);
const report = formatSpeakerReport(pick, sinks);
console.log(report.summary);

if (!pick) {
	process.exit(1);
}

if (pick.default) {
	console.log(`default sink already ${pick.id} (${pick.name})`);
} else if (dryRun) {
	console.log(`would wpctl set-default ${pick.id}`);
} else {
	run(`wpctl set-default ${pick.id}`);
	console.log(`wpctl set-default ${pick.id}`);
}

if (beep && !dryRun) {
	try {
		run('paplay /usr/share/sounds/freedesktop/stereo/complete.oga', { timeout: 6000 });
		console.log('played a short confirmation sound on the default sink');
	} catch {
		try {
			run('speaker-test -c 2 -t sine -f 440 -l 1', { timeout: 4000 });
			console.log('played a short confirmation tone on the default sink');
		} catch {
			console.log('could not play a test sound (paplay / speaker-test missing)');
		}
	}
}
