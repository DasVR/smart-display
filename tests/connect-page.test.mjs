import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildConnect, buildHtml, buildMarkdown, createConnectPage, liveLine, wallAddress } from '../src/lib/server/connectPage.js';

const NOW = Date.parse('2026-10-21T14:00:00Z');

function fakeRes() {
	return {
		status: 0,
		headers: {},
		body: '',
		writeHead(status, headers) {
			this.status = status;
			this.headers = headers;
		},
		end(body) {
			this.body = body;
		}
	};
}

test('the wall address comes from the request, with localhost as the fallback', () => {
	assert.equal(wallAddress({ host: 'wall.local:3000' }), 'http://wall.local:3000');
	assert.equal(wallAddress({ 'x-forwarded-host': 'wall.example.com', 'x-forwarded-proto': 'https', host: 'internal:3000' }), 'https://wall.example.com');
	assert.equal(wallAddress({ 'x-forwarded-host': 'a.example.com, b.proxy' }), 'http://a.example.com');
	assert.equal(wallAddress({}), 'http://localhost:3000');
	assert.equal(wallAddress({ host: 'evil"><script>' }), 'http://localhost:3000', 'a header that is not a host is not parroted back');
});

test('the live line is a count and a time, and nothing else about the sessions', () => {
	assert.equal(liveLine([], NOW), '0 sessions reporting');
	assert.equal(liveLine([{ at: NOW - 30000 }], NOW), '1 session reporting · last 30 s ago');
	assert.equal(liveLine([{ at: NOW - 30000 }, { at: NOW - 5000, task: 'SECRET', prompt: 'SECRET' }], NOW), '2 sessions reporting · last 5 s ago');
	assert.equal(liveLine([{ at: NOW - 3 * 60000 }], NOW), '1 session reporting · last 3 min ago');
	assert.equal(liveLine([{ at: NOW - 2 * 3600000 }], NOW), '1 session reporting · last 2 h ago');
	const page = buildConnect({ wall: 'http://wall.local:3000', sessions: [{ at: NOW, task: 'SECRET-TASK', prompt: 'SECRET-PROMPT' }], now: NOW });
	assert.ok(!/SECRET/i.test(buildMarkdown(page)));
	assert.ok(!/SECRET/i.test(buildHtml(page)));
});

test('the markdown fills the wall address in and never shows a token', () => {
	const md = buildMarkdown(buildConnect({ wall: 'https://wall.example.com', now: NOW }));
	assert.match(md, /npm run agent-status -- --url https:\/\/wall\.example\.com --token <token>/);
	assert.match(md, /WALL_URL=https:\/\/wall\.example\.com/);
	assert.match(md, /curl -s https:\/\/wall\.example\.com\/api\/agents\/sessions/);
	assert.match(md, /Set yourself up from https:\/\/wall\.example\.com\/connect/);
	assert.match(md, /npm run api-token prints it/);
	assert.ok(!md.includes('localhost:3000'));
	// inside the fences, every token mention is the placeholder, never a value
	const fences = md.match(/```[a-z]*\n[\s\S]*?```/g) || [];
	assert.ok(fences.length >= 8, 'commands in fenced blocks');
	for (const f of fences) for (const m of f.matchAll(/--token \S+/g)) assert.equal(m[0], '--token <token>');
	assert.ok(!/Bearer (?!<token>)\S+/.test(md));
});

test('the markdown has every section, numbered, each with a check', () => {
	const md = buildMarkdown(buildConnect({ wall: 'http://wall.local:3000', now: NOW }));
	for (const title of [
		'## 1. Claude Code on your computer',
		'## 2. Claude Code on the web',
		"## 3. Cursor on your computer",
		"## 4. Cursor's cloud agents",
		'## 5. Saying what you are doing (for agents)',
		'## 6. Undo',
		'## 7. When it is not showing'
	])
		assert.ok(md.includes(title), title);
	assert.match(md, /```bash\nnpm run agent-status -- --url/);
	assert.match(md, /```json\n\{\n  "extraKnownMarketplaces"/);
	assert.match(md, /\/plugin install wall-status@smart-display/);
	assert.match(md, /npm run agent-status -- --repo <path-to-that-repo>/);
	assert.match(md, /npm run agent-status -- --cursor-key <key>/);
	assert.match(md, /npm run agent-status -- --uninstall/);
	assert.match(md, /report_progress/);
	assert.equal((md.match(/^Check:/gm) || []).length, 6, 'each setup section ends with a check');
	assert.match(md, /1\. No wall address where the session runs/);
	assert.match(md, /2\. The token was refused/);
	assert.match(md, /3\. The wall is not reachable from a cloud session/);
});

test('the HTML comes from the same content, escaped, with copy buttons', () => {
	const html = buildHtml(buildConnect({ wall: 'http://wall.local:3000', sessions: [{ at: NOW - 30000 }], now: NOW }));
	assert.match(html, /^<!doctype html>/);
	assert.match(html, /<h1>Connect agents to this wall<\/h1>/);
	assert.match(html, /1 session reporting · last 30 s ago/);
	assert.match(html, /npm run agent-status -- --url http:\/\/wall\.local:3000 --token &lt;token&gt;/);
	assert.match(html, /&quot;extraKnownMarketplaces&quot;/, 'the JSON block is escaped');
	assert.ok(!html.includes('<token>'), 'the placeholder never parses as a tag');
	assert.ok(!/SECRET/i.test(html));
	const buttons = (html.match(/data-copy="c\d+"/g) || []).length;
	const blocks = (html.match(/<pre id="c\d+"/g) || []).length;
	assert.ok(blocks >= 8 && buttons === blocks, 'every command block gets a copy button');
	assert.match(html, /Plus Jakarta Sans Variable/);
	assert.ok(!/src="https?:|link rel="stylesheet"/.test(html), 'no external fonts or scripts');
});

test('the route: public, the right content types, both markdown paths identical', () => {
	const page = createConnectPage({ sessions: () => [{ at: NOW - 30000, task: 'SECRET' }], now: () => NOW });
	const get = (url, headers = { host: 'wall.local:3000' }) => {
		const res = fakeRes();
		assert.equal(page.handleHttp({ method: 'GET', url, headers }, res), true, url);
		return res;
	};
	const html = get('/connect');
	assert.equal(html.status, 200, 'no token asked for: the route is public');
	assert.match(html.headers['Content-Type'], /^text\/html/);
	assert.match(html.body, /1 session reporting · last 30 s ago/);
	assert.ok(!/SECRET/i.test(html.body));
	const a = get('/connect.md');
	const b = get('/api/agents/connect');
	assert.match(a.headers['Content-Type'], /^text\/markdown/);
	assert.match(b.headers['Content-Type'], /^text\/markdown/);
	assert.equal(a.body, b.body, 'the two markdown endpoints cannot drift');
	assert.match(a.body, /# Connect agents to this wall/);
	// trailing slashes and forwarded hosts work the same
	assert.match(get('/connect/', { host: 'wall.local:3000' }).body, /Connect agents/);
	assert.ok(get('/connect.md', { 'x-forwarded-host': 'w.example.com', 'x-forwarded-proto': 'https' }).body.includes('https://w.example.com/connect.md'));
	// anything else is somebody else's route
	assert.equal(page.handleHttp({ method: 'GET', url: '/api/agents/sessions', headers: {} }, fakeRes()), false);
	assert.equal(page.handleHttp({ method: 'GET', url: '/connectish', headers: {} }, fakeRes()), false);
	assert.equal(page.handleHttp({ method: 'POST', url: '/connect', headers: {} }, fakeRes()), false);
});

test('the page fonts: the two the app already bundles, nothing else', () => {
	const fontDir = mkdtempSync(path.join(tmpdir(), 'connect-fonts-'));
	mkdirSync(path.join(fontDir, 'plus-jakarta-sans/files'), { recursive: true });
	writeFileSync(path.join(fontDir, 'plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2'), 'woff2-bytes');
	const page = createConnectPage({ fontDir });
	const res = fakeRes();
	assert.equal(page.handleHttp({ method: 'GET', url: '/connect/fonts/plus-jakarta-sans-latin-wght-normal.woff2', headers: {} }, res), true);
	assert.equal(res.status, 200);
	assert.equal(res.headers['Content-Type'], 'font/woff2');
	assert.equal(String(res.body), 'woff2-bytes');
	// a font the app does not ship is a 404, and so is one missing from disk
	for (const url of ['/connect/fonts/comic-sans.woff2', '/connect/fonts/fira-code-latin-wght-normal.woff2']) {
		const r = fakeRes();
		assert.equal(page.handleHttp({ method: 'GET', url, headers: {} }, r), true, url);
		assert.equal(r.status, 404, url);
	}
	// names are matched within one path segment only: no walking out of the dir
	assert.equal(page.handleHttp({ method: 'GET', url: '/connect/fonts/..%2F..%2Fapi-token', headers: {} }, fakeRes()), false);
});
