#!/usr/bin/env node
/**
 * Sign the wall's Apple Music player into your Apple ID, once.
 *   npm run apple-music:login              headless; sign in from your laptop
 *                                          through Chrome's remote inspector
 *   npm run apple-music:login -- --headed  a real window, if this machine has
 *                                          a desktop (or `ssh -X`)
 *
 * It asks the running server to close its own player first (they share the
 * profile in data/apple-music-profile), opens music.apple.com, starts
 * Apple's sign-in, and waits until MusicKit says you're signed in. Apple asks
 * again about every six months; run this again then. See docs/apple-music.md.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome } from '../src/lib/server/appleMusic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const profileDir = path.join(dataDir, 'apple-music-profile');
const headed = process.argv.includes('--headed');
const debugPort = Number(process.env.APPLE_MUSIC_DEBUG_PORT || 9222);
const WAIT_MS = Number(process.env.APPLE_MUSIC_LOGIN_MINUTES || 10) * 60000;

async function releaseServerPlayer() {
	const tokenFile = path.join(dataDir, 'api-token');
	const token = process.env.DISPLAY_API_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
	try {
		await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/apple-music/release`, {
			method: 'POST',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			signal: AbortSignal.timeout(5000)
		});
	} catch {
		/* server not running: nothing to release */
	}
}

const executablePath = findChrome();
if (!executablePath) {
	console.error('Google Chrome is not installed. Apple Music needs it for Widevine; see docs/apple-music.md.');
	process.exit(1);
}

await releaseServerPlayer();
mkdirSync(profileDir, { recursive: true });

let session;
try {
	session = await launchChrome({
		executablePath,
		profileDir,
		storefront: process.env.APPLE_MUSIC_STOREFRONT || 'us',
		headless: !headed,
		images: true,
		args: headed ? [] : [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1']
	});
} catch (e) {
	console.error(`Chrome didn't start: ${e.message}`);
	console.error('If the profile is in use, stop the server (or wait for its player to close) and try again.');
	process.exit(1);
}
const { context, page } = session;

const signedIn = () => page.evaluate(() => Boolean(window.MusicKit?.getInstance?.()?.isAuthorized)).catch(() => false);

if (await signedIn()) {
	console.log('Already signed in. Nothing to do.');
	await context.close();
	process.exit(0);
}

// Apple's sign-in opens in its own page
page.evaluate(() => window.MusicKit.getInstance().authorize()).catch(() => {});

if (headed) {
	console.log('Sign in with your Apple ID in the window that opened.');
} else {
	console.log(`
Sign in from your laptop:

  1. Forward the inspector port:   ssh -L ${debugPort}:127.0.0.1:${debugPort} <this machine>
  2. In Chrome on the laptop open  chrome://inspect/#devices
     -> Configure… -> add  localhost:${debugPort}
  3. Under "Remote Target", click "inspect" on the Apple sign-in page
     (authorize.music.apple.com) and sign in there, 2FA code included.

Waiting up to 10 minutes…`);
}

const until = Date.now() + WAIT_MS;
while (Date.now() < until) {
	if (await signedIn()) {
		console.log('Signed in. Say "hey wall, play something".');
		await context.close();
		process.exit(0);
	}
	await new Promise((r) => setTimeout(r, 2000));
}
console.error('Timed out waiting for the sign-in.');
await context.close();
process.exit(1);
