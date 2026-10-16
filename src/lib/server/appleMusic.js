/**
 * Apple Music on the wall: Apple's own web player (MusicKit, on
 * music.apple.com) in a headless Google Chrome, with no window. A slim
 * Cider: just the streaming part, driven by "hey wall, play …".
 *
 *   GET  /api/apple-music           chrome found?, running?, signed in?, enhancer, now playing
 *   POST /api/apple-music           { enhance } settings
 *   POST /api/apple-music/play      { text } ("play some jazz") or { term, kind }
 *   POST /api/apple-music/control   { action: pause | play | next | previous }
 *   POST /api/apple-music/release   close the browser (the login script asks first)
 *
 * Same Bearer token as /api/tasks.
 *
 * Why Google Chrome, not a slimmer build: Apple Music streams are Widevine
 * protected AAC, and only Google's Chrome (or CastLabs Electron) carries
 * Widevine and the AAC decoder; chrome-headless-shell and open Chromium have
 * neither (docs/apple-music.md). It is slimmed instead: no window, no GPU,
 * low-end-device mode, one renderer, images and fonts never fetched (about
 * 480 MB measured, against 540 MB stock; Chrome's own floor is ~450 MB, so
 * a bare MusicKit page instead of Apple's web app saved only ~15 MB), and it
 * closes itself after IDLE_CLOSE_MS without music.
 *
 * Quality: the web player's stream is 256 kbps AAC (lossless needs Apple's
 * FairPlay, only on Apple devices). The optional enhancer (enhancer.js,
 * ours, Web Audio) gives that stream some of the air and weight an encoder
 * takes away; it can be turned off from the phone.
 *
 * Sign-in happens once, through `npm run apple-music:login`, into
 * data/apple-music-profile (gitignored). Apple asks for it again about
 * every six months.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { parsePlayRequest, pickResult, queueFor, searchTypes, speakPick } from '../musicRequest.js';
import { normalizeCommand } from '../wallActions.js';
import { ENHANCER_SOURCE } from './appleMusicEnhancer.js';
import { authorized, loadApiToken } from './taskService.js';

const execFileAsync = promisify(execFile);

export const CHROME_CANDIDATES = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
const HOME_URL = (storefront) => `https://music.apple.com/${storefront}/browse`;
const READY_MS = 45000;
const POLL_MS = 1000;
/** No music for this long and the browser closes, giving its memory back. */
const IDLE_CLOSE_MS = 20 * 60000;
/** A paused Apple Music track still counts as "what's playing" this long. */
const PAUSED_KEEP_MS = 30 * 60000;
const MAX_BODY = 4 * 1024;

// MusicKit.PlaybackStates
const PLAYING = 2;
const PAUSED = 3;

/** Flags that trim headless Chrome down to a music player. */
export const SLIM_ARGS = [
	'--autoplay-policy=no-user-gesture-required',
	'--disable-gpu',
	'--in-process-gpu',
	'--enable-low-end-device-mode',
	'--disable-site-isolation-trials',
	'--renderer-process-limit=1',
	'--disable-features=Translate,OptimizationHints,MediaRouter,BackForwardCache,InterestFeedContentSuggestions',
	'--disable-extensions',
	'--disable-component-extensions-with-background-pages',
	'--disable-default-apps',
	'--no-first-run',
	'--js-flags=--max-old-space-size=256'
];

export function findChrome(env = process.env, exists = existsSync) {
	const wanted = String(env.APPLE_MUSIC_CHROME || '').trim();
	if (wanted) return exists(wanted) ? wanted : '';
	return CHROME_CANDIDATES.find((p) => exists(p)) || '';
}

/** A normal desktop Chrome user agent: Apple's player turns "HeadlessChrome" away. */
export function desktopUserAgent(versionText) {
	const major = String(versionText || '').match(/(\d+)\.\d+/)?.[1] || '140';
	return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** The status sample (from the page) as a now-playing track. */
export function sampleToTrack(sample, at = Date.now()) {
	const item = sample?.item;
	if (!item?.name) return null;
	return {
		playing: sample.state === PLAYING,
		paused: sample.state === PAUSED,
		artist: item.artistName || 'Unknown artist',
		title: item.name,
		album: item.albumName || '',
		art: item.art || '',
		position: Number(sample.time) || 0,
		positionAt: at,
		length: Number(sample.duration) || (Number(item.durationMs) || 0) / 1000,
		player: 'Apple Music',
		source: 'apple-music'
	};
}

/* ---------- run inside music.apple.com (page.evaluate) ---------- */

function inPageReady() {
	const mk = window.MusicKit?.getInstance?.();
	return mk ? { authorized: Boolean(mk.isAuthorized), storefront: mk.storefrontId || '' } : null;
}

function inPageStatus() {
	const mk = window.MusicKit?.getInstance?.();
	if (!mk) return null;
	const it = mk.nowPlayingItem;
	const a = it?.attributes || {};
	const art = a.artwork?.url ? a.artwork.url.replace('{w}', '600').replace('{h}', '600').replace('{f}', 'jpg') : '';
	return {
		authorized: Boolean(mk.isAuthorized),
		state: mk.playbackState,
		time: mk.currentPlaybackTime || 0,
		duration: mk.currentPlaybackDuration || 0,
		item: it ? { id: it.id, name: a.name || it.title || '', artistName: a.artistName || '', albumName: a.albumName || '', durationMs: a.durationInMillis || 0, art } : null,
		enhancer: window.__wallEnhancer?.status?.() || null
	};
}

async function inPageApi({ url, params }) {
	const mk = window.MusicKit.getInstance();
	const res = await mk.api.music(url, params || {});
	return res?.data ?? null;
}

async function inPageQueue({ queue, songs, shuffle }) {
	const mk = window.MusicKit.getInstance();
	mk.shuffleMode = shuffle ? 1 : 0;
	await mk.setQueue(songs ? { songs, startPlaying: true } : { ...queue, startPlaying: true });
	if (mk.playbackState !== 2) await mk.play();
	return mk.playbackState;
}

async function inPageControl(action) {
	const mk = window.MusicKit.getInstance();
	if (action === 'pause') await mk.pause();
	else if (action === 'play') await mk.play();
	else if (action === 'next') await mk.skipToNextItem();
	else if (action === 'previous') await mk.skipToPreviousItem();
	else if (action === 'stop') await mk.stop();
	return mk.playbackState;
}

function inPageEnhance(on) {
	window.__wallEnhancer?.set?.(Boolean(on));
	return window.__wallEnhancer?.status?.() || null;
}

/* ---------- the player ---------- */

function readJson(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

function readBody(req) {
	const plain = /^text\/plain/i.test(req.headers?.['content-type'] ?? '');
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (c) => {
			raw += c;
			if (raw.length > MAX_BODY) {
				reject(Object.assign(new Error('body too large'), { status: 413 }));
				req.destroy();
			}
		});
		req.on('end', () => {
			if (!raw.trim()) return resolve({});
			try {
				const v = JSON.parse(raw);
				resolve(v && typeof v === 'object' ? v : { text: String(v) });
			} catch {
				if (plain) return resolve({ text: raw.trim() });
				reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

async function chromeVersion(exe) {
	try {
		const { stdout } = await execFileAsync(exe, ['--version'], { timeout: 5000 });
		return stdout;
	} catch {
		return '';
	}
}

/** Starts headless Chrome on the profile and returns { context, page }. */
export async function launchChrome({ executablePath, profileDir, storefront, enhance = true, headless = true, images = false, args = [] }) {
	const { chromium } = await import('playwright-core');
	const ua = desktopUserAgent(await chromeVersion(executablePath));
	const context = await chromium.launchPersistentContext(profileDir, {
		executablePath,
		headless,
		// sound on (Playwright mutes headless Chrome by default)
		ignoreDefaultArgs: ['--mute-audio'],
		args: [...SLIM_ARGS, `--user-agent=${ua}`, ...args],
		viewport: { width: 800, height: 600 }
	});
	// pictures and fonts are for eyes; this browser has none
	if (!images) {
		await context.route('**/*', (route) => {
			const kind = route.request().resourceType();
			return kind === 'image' || kind === 'font' ? route.abort() : route.continue();
		});
	}
	// with the enhancer off the audio is never touched (no Web Audio at all)
	await context.addInitScript({ content: enhance ? ENHANCER_SOURCE : 'window.__wallEnhancerOff = true;' });
	const page = context.pages()[0] || (await context.newPage());
	await page.goto(HOME_URL(storefront), { waitUntil: 'domcontentloaded', timeout: READY_MS });
	await page.waitForFunction(inPageReady, null, { timeout: READY_MS });
	return { context, page };
}

export function createAppleMusic({
	dataDir,
	env = process.env,
	log = console,
	now = () => Date.now(),
	onChange = () => {},
	launch = launchChrome,
	exists = existsSync
}) {
	const settingsFile = path.join(dataDir, 'apple-music.json');
	const profileDir = path.join(dataDir, 'apple-music-profile');
	const tokenFile = path.join(dataDir, 'api-token');
	let settings = { enhance: true, ...readJson(settingsFile, {}) };
	const storefront = String(env.APPLE_MUSIC_STOREFRONT || 'us').trim() || 'us';

	let session = null; // { context, page }
	let starting = null;
	let poller = 0;
	let last = null; // latest status sample
	let lastAt = 0;
	let musicAt = 0; // last time it was playing (or was asked to)
	let lastKey = '';
	let silentPolls = 0;

	const chrome = () => findChrome(env, exists);

	function track() {
		if (!session || !last) return null;
		const t = sampleToTrack(last, lastAt);
		if (!t) return null;
		if (!t.playing && now() - musicAt > PAUSED_KEEP_MS) return null;
		return t;
	}

	async function poll() {
		if (!session) return;
		try {
			last = await session.page.evaluate(inPageStatus);
			lastAt = now();
		} catch (e) {
			log.warn?.(`apple music: lost the player (${e.message})`);
			await close();
			return;
		}
		if (last?.state === PLAYING) musicAt = now();
		// protected audio coming through the enhancer silent: start again without it
		const enh = last?.enhancer;
		silentPolls = last?.state === PLAYING && enh?.enabled && enh.wired && enh.level < 1e-5 && last.time > 3 ? silentPolls + 1 : 0;
		if (silentPolls >= 6) {
			silentPolls = 0;
			log.warn?.('apple music: the enhancer is silent, turning it off');
			settings.enhance = false;
			saveSettings();
			await restartKeepingPlace();
			return;
		}
		const t = sampleToTrack(last, lastAt);
		const key = t ? `${t.title}|${t.artist}|${t.playing}` : '';
		if (key !== lastKey) {
			lastKey = key;
			onChange(t);
		}
		if (now() - musicAt > IDLE_CLOSE_MS) {
			log.info?.('apple music: idle, closing the browser');
			await close();
		}
	}

	async function start() {
		if (session) return session;
		if (starting) return starting;
		const executablePath = chrome();
		if (!executablePath) throw Object.assign(new Error('Google Chrome is not installed'), { code: 'no-chrome' });
		mkdirSync(profileDir, { recursive: true });
		starting = (async () => {
			try {
				session = await launch({ executablePath, profileDir, storefront, enhance: settings.enhance });
				session.enhance = settings.enhance;
				musicAt = now();
				await session.page.evaluate(inPageEnhance, settings.enhance).catch(() => {});
				poller = setInterval(() => poll().catch(() => {}), POLL_MS);
				poller.unref?.();
				return session;
			} finally {
				starting = null;
			}
		})();
		return starting;
	}

	async function close() {
		clearInterval(poller);
		poller = 0;
		const s = session;
		session = null;
		last = null;
		if (lastKey) {
			lastKey = '';
			onChange(null);
		}
		if (s) await s.context.close().catch(() => {});
	}

	async function api(url, params) {
		return session.page.evaluate(inPageApi, { url, params });
	}

	/** "Play …": search, pick, queue, play. Resolves { ok, say }; never rejects. */
	async function play(request) {
		const req = typeof request === 'string' ? parsePlayRequest(normalizeCommand(request)) : request;
		if (!req) return { ok: false, say: 'What should I play?' };
		try {
			await start();
		} catch (e) {
			log.warn?.(`apple music: ${e.message}`);
			if (e.code === 'no-chrome') return { ok: false, reason: 'no-chrome', say: 'Apple Music needs Google Chrome on the wall. See the Apple Music setup notes.' };
			return { ok: false, reason: 'start', say: "Apple Music didn't start. Try again in a moment." };
		}
		try {
			const ready = await session.page.evaluate(inPageReady);
			if (!ready?.authorized) return { ok: false, reason: 'signed-out', say: 'Apple Music isn’t signed in on the wall yet.' };
			const sf = ready.storefront || storefront;
			let pick = null;
			let songs = null;
			if (req.kind === 'recent') {
				pick = asRecent(await api('/v1/me/recent/played', { limit: 1 }));
			} else if (req.kind === 'library-playlist') {
				const data = await api('/v1/me/library/search', { term: req.term, types: 'library-playlists', limit: 1 });
				const item = data?.results?.['library-playlists']?.data?.[0];
				pick = item ? { type: 'library-playlists', id: item.id, name: item.attributes?.name || req.term, artistName: '' } : null;
				if (!pick) {
					const any = await api(`/v1/catalog/${sf}/search`, { term: req.term, types: 'playlists', limit: 1 });
					pick = pickResult(any?.results, 'playlist');
				}
			} else {
				const data = await api(`/v1/catalog/${sf}/search`, { term: req.term, types: searchTypes(req.kind), limit: 3, ...(req.kind === 'any' ? { with: 'topResults' } : {}) });
				pick = pickResult(data?.results, req.kind);
			}
			if (!pick) return { ok: false, reason: 'not-found', say: speakPick(null) };
			if (pick.type === 'artists') {
				const top = await api(`/v1/catalog/${sf}/artists/${pick.id}/view/top-songs`, { limit: 20 });
				songs = (top?.data || []).map((s) => s.id).filter(Boolean);
				if (!songs.length) return { ok: false, reason: 'not-found', say: speakPick(null) };
			}
			const queue = songs ? null : queueFor(pick);
			await session.page.evaluate(inPageQueue, { queue, songs, shuffle: Boolean(songs) });
			musicAt = now();
			setTimeout(() => poll().catch(() => {}), 300).unref?.();
			return { ok: true, pick, say: speakPick(pick) };
		} catch (e) {
			log.warn?.(`apple music: play failed (${e.message})`);
			return { ok: false, reason: 'failed', say: "Apple Music couldn't play that." };
		}
	}

	function asRecent(data) {
		const item = data?.data?.[0];
		if (!item?.id || !item?.type) return null;
		return { type: item.type, id: item.id, name: item.attributes?.name || 'your music', artistName: item.attributes?.artistName || '' };
	}

	/** Transport for the wall's music commands, shaped like runPlayerctl's answer. */
	async function control(action) {
		if (!session) return { ok: false, reason: 'idle' };
		try {
			await session.page.evaluate(inPageControl, action);
			if (action === 'play') musicAt = now();
			setTimeout(() => poll().catch(() => {}), 200).unref?.();
			return { ok: true };
		} catch (e) {
			return { ok: false, reason: 'failed', error: e.message };
		}
	}

	/** Is Apple Music the wall's player right now (so pause/next go here)? */
	function isActive() {
		return Boolean(track());
	}

	function saveSettings() {
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
	}

	/** Close and reopen the player, carrying on from the same song and second. */
	async function restartKeepingPlace() {
		const item = last?.item;
		const at = Number(last?.time) || 0;
		const wasPlaying = last?.state === PLAYING;
		await close();
		if (!item?.id) return;
		try {
			await start();
			await session.page.evaluate(inPageQueue, { queue: { song: item.id, startTime: at }, songs: null, shuffle: false });
			if (!wasPlaying) await session.page.evaluate(inPageControl, 'pause');
		} catch (e) {
			log.warn?.(`apple music: couldn't carry on after a restart (${e.message})`);
		}
	}

	async function setSettings(patch = {}) {
		if (typeof patch.enhance === 'boolean') settings.enhance = patch.enhance;
		saveSettings();
		if (session) {
			// on/off is a bypass inside the page; turning it on in a player
			// started without it needs a fresh start
			if (settings.enhance && !session.enhance) await restartKeepingPlace();
			else await session.page.evaluate(inPageEnhance, settings.enhance).catch(() => {});
		}
		return snapshot();
	}

	function snapshot() {
		return {
			chrome: chrome() || null,
			running: Boolean(session),
			signedIn: last ? Boolean(last.authorized) : null,
			enhance: settings.enhance,
			enhancer: last?.enhancer || null,
			nowPlaying: track()
		};
	}

	async function handleHttp(req, res) {
		const url = new URL(req.url, 'http://local');
		if (!url.pathname.startsWith('/api/apple-music')) return false;
		const send = (status, data) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(data));
		};
		if (!authorized(req.headers, loadApiToken(tokenFile, env))) {
			send(401, { error: 'unauthorized' });
			return true;
		}
		try {
			if (req.method === 'GET' && url.pathname === '/api/apple-music') return send(200, snapshot()), true;
			if (req.method === 'POST' && url.pathname === '/api/apple-music') return send(200, await setSettings(await readBody(req))), true;
			if (req.method === 'POST' && url.pathname === '/api/apple-music/play') {
				const body = await readBody(req);
				const r = await play(body.term !== undefined ? { term: String(body.term), kind: body.kind || 'any' } : `play ${String(body.text || '').replace(/^\s*play\s+/i, '')}`);
				return send(r.ok ? 200 : 422, r), true;
			}
			if (req.method === 'POST' && url.pathname === '/api/apple-music/control') {
				const body = await readBody(req);
				return send(200, await control(String(body.action || ''))), true;
			}
			if (req.method === 'POST' && url.pathname === '/api/apple-music/release') {
				await close();
				return send(200, { ok: true }), true;
			}
			send(404, { error: 'not found' });
		} catch (e) {
			send(e.status || 400, { error: e.message });
		}
		return true;
	}

	return { play, control, isActive, track, snapshot, setSettings, close, handleHttp, profileDir };
}
