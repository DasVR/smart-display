/**
 * GET /connect, /connect.md and /api/agents/connect: one small page that tells
 * a person or an agent exactly how to hook Claude Code and Cursor up to this
 * wall (docs/agent-status.md), with the wall's address already filled in from
 * the request. The markdown and the HTML come from the one buildConnect()
 * below, so the two can never drift. Everything here is public: a count of
 * sessions and when the last one reported, but no tokens, prompts or sessions.
 *
 * The report tool, the checks and the plugin all live elsewhere; this module
 * only describes them. Keep the wording in step with
 * scripts/setup-agent-status.mjs and plugins/wall-status/README.md.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../node_modules/@fontsource-variable');
// the same woff2 files the app bundles; the page asks for them by these names
const FONTS = {
	'plus-jakarta-sans-latin-wght-normal.woff2': 'plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2',
	'fira-code-latin-wght-normal.woff2': 'fira-code/files/fira-code-latin-wght-normal.woff2'
};

/** The address this wall answers at, from the request's headers. */
export function wallAddress(headers = {}) {
	const host = String(headers['x-forwarded-host'] || headers.host || '')
		.split(',')[0]
		.trim();
	if (!/^[\w.\-[\]:]+$/.test(host)) return 'http://localhost:3000';
	const proto = String(headers['x-forwarded-proto'] || '')
		.split(',')[0]
		.trim()
		.toLowerCase();
	return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

/** "2 sessions reporting · last 30 s ago" — the count and the time, nothing else. */
export function liveLine(sessions = [], now = Date.now()) {
	const n = sessions.length;
	const count = `${n} session${n === 1 ? '' : 's'} reporting`;
	const last = sessions.reduce((m, s) => Math.max(m, Number(s?.at) || 0), 0);
	if (!last) return count;
	const secs = Math.max(0, Math.round((now - last) / 1000));
	if (secs < 60) return `${count} · last ${secs} s ago`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${count} · last ${mins} min ago`;
	return `${count} · last ${Math.floor(mins / 60)} h ago`;
}

/** The whole page as plain data: the live line, the intro, the agent prompt
 *  and the seven sections. Markdown and HTML are both rendered from this. */
export function buildConnect({ wall = 'http://localhost:3000', sessions: seen = [], now = Date.now() } = {}) {
	const prompt = `Set yourself up from ${wall}/connect: fetch ${wall}/connect.md and follow it.`;
	return {
		wall,
		live: liveLine(seen, now),
		intro: [
			`This wall shows what Claude Code and Cursor are doing while they work, on your computer and in the cloud. Each setup below is a command or two, with a check after it and what to do when the check fails. A person can follow it here; an agent reads this same page as plain markdown at ${wall}/connect.md.`,
			`Wherever a command says <token>, use the wall's API token: on the wall, npm run api-token prints it (it is kept in data/api-token). Hooks on the wall itself don't need it; everywhere else does.`
		],
		prompt,
		sections: [
			{
				title: 'Claude Code on your computer',
				parts: [
					{
						p: "Run this on that computer, from a checkout of the wall's repo (git clone https://github.com/dasvr/smart-display). It copies the hook script to ~/.config/smart-display/, saves the wall's address and token beside it, and adds the hooks to ~/.claude/settings.json. Everything already in those files stays."
					},
					{ code: `npm run agent-status -- --url ${wall} --token <token>`, lang: 'bash' },
					{ p: `Or add the plugin instead, with WALL_URL=${wall} and WALL_TOKEN=<token> in the environment Claude Code runs in:` },
					{ code: '/plugin marketplace add dasvr/smart-display\n/plugin install wall-status@smart-display' }
				],
				check: `npm run agent-status -- --check answers "The wall answers at ${wall} (… sessions known)". New sessions show on the wall from then on; restart ones already open. The setup script's last line says the same.`,
				fail: `The check's message says which: no wall at that address (is it on, and is this the right address?), the token refused (pass --token with the one npm run api-token prints), or the wall too old — update it to the latest master and restart it.`
			},
			{
				title: 'Claude Code on the web',
				parts: [
					{
						p: `A cloud session only runs the hooks committed in the repository it works on (never your own ~/.claude settings), and it has to reach the wall over the internet. In that repo's .claude/settings.json, add:`
					},
					{
						code: '{\n  "extraKnownMarketplaces": { "smart-display": { "source": { "source": "github", "repo": "dasvr/smart-display" } } },\n  "enabledPlugins": { "wall-status@smart-display": true }\n}',
						lang: 'json'
					},
					{
						p: 'Commit that. Then give the wall an address the internet can reach: a Tailscale Funnel (tailscale funnel 3000, on the wall) or a Cloudflare Tunnel to port 3000. The hook endpoint answers to the internet from then on, so give the wall a token first (npm run api-token on it).'
					},
					{
						p: "Last, in the environment's settings on claude.ai/code: set WALL_URL to the tunnel's https address and WALL_TOKEN to <token>, and allow the wall's host in the network policy, or the requests are refused."
					},
					{ p: 'From any machine, the sessions endpoint is the other check:' },
					{ code: `curl -s ${wall}/api/agents/sessions -H "Authorization: Bearer <token>"`, lang: 'bash' }
				],
				check: `Start a cloud session in that repo; within a few seconds it appears in that list (and on the wall's Agents view), marked "cloud".`,
				fail: `The settings block is not committed in that repo, WALL_URL or WALL_TOKEN is missing from the cloud environment, the wall's host is not allowed by its network policy, or the tunnel is down. npm run agent-status -- --check --url <tunnel-address> from anywhere says which.`
			},
			{
				title: 'Cursor on your computer',
				parts: [
					{
						p: `The same one command sets Cursor up on a computer: it adds the hooks to ~/.cursor/hooks.json (use --only cursor to leave Claude Code's settings alone):`
					},
					{ code: `npm run agent-status -- --url ${wall} --token <token>`, lang: 'bash' }
				],
				check: `npm run agent-status -- --check answers, and a new Cursor session shows on the wall's Agents view (and in the curl from section 2). Restart sessions that were already open.`,
				fail: `The same causes as section 1 — read the check's message.`
			},
			{
				title: `Cursor's cloud agents`,
				parts: [
					{
						p: 'Two parts. First, put the hooks, the report tool and the wall-report rule into the repo the cloud agents work on, and commit what it writes:'
					},
					{ code: `npm run agent-status -- --repo <path-to-that-repo>`, lang: 'bash' },
					{
						p: `Second, on the wall itself, give it a Cursor API key (Cursor Dashboard → API Keys), so it asks Cursor's Cloud Agents API about your agents every minute (an empty key string removes it again):`
					},
					{ code: `npm run agent-status -- --cursor-key <key>`, lang: 'bash' }
				],
				check: `Start a cloud agent in Cursor; within a minute it shows on the wall (and in the sessions curl above), marked "cloud".`,
				fail: `The files aren't committed in that repo; the key is missing or wrong (the wall's log says "agents: Cursor cloud: …"); or the wall can't reach api.cursor.com.`
			},
			{
				title: 'Saying what you are doing (for agents)',
				parts: [
					{
						p: 'The hooks tell the wall *that* you are working; tell it *what* you are working on. Call the `report_progress` tool (the `wall` MCP server the setup installs), or from a shell: node hooks/wall-report.mjs "Fix the flaky weather test" --step "Reproducing it" --done 1 --total 4. Call it when you start a task of more than a couple of steps (summary, step, total), at each milestone (step, done), when you need the user (phase "waiting", and what you need), and when you finish (phase "done", link to the pull request). A few plain words each time — the wall is read from across the room. The wall-report skill (Claude Code) and rule (Cursor), both installed by the setups above, have the details.'
					}
				],
				check: `The wall's card for your session shows your summary and step.`,
				fail: `Nothing breaks — with no wall set up the tool says so and your work carries on.`
			},
			{
				title: 'Undo',
				parts: [{ code: `npm run agent-status -- --uninstall\nnpm run agent-status -- --repo <path-to-that-repo> --uninstall`, lang: 'bash' }],
				check: 'wall-status.mjs is gone from ~/.claude/settings.json and ~/.cursor/hooks.json. It takes out only what it added; everything else in those files stays. Restart open sessions to drop the hooks.',
				fail: ''
			},
			{
				title: 'When it is not showing',
				parts: [{ p: 'One command names the cause:' }, { code: 'npm run agent-status -- --check', lang: 'bash' }, { p: 'The three common ones:' }, {
					ol: [
						'No wall address where the session runs: WALL_URL missing from the environment and no saved ~/.config/smart-display/wall-status.json (section 1 writes it). The hook script does nothing at all without one.',
						'The token was refused ("The wall wants its API token"). Pass --token with the one npm run api-token prints on the wall.',
						`The wall is not reachable from a cloud session: the tunnel is down, or its host is not allowed in the cloud environment's network policy.`
					]
				}, {
					p: 'Hooks load when a session starts, so restart sessions that were already open. A session quiet for 15 minutes stops counting as working, by design.'
				}],
				check: '',
				fail: ''
			}
		],
		footer: 'What the wall shows and what leaves the machine: docs/agent-status.md in the repo.'
	};
}

/* ---------- markdown (GET /connect.md and /api/agents/connect) ---------- */

export function buildMarkdown(page) {
	const out = ['# Connect agents to this wall', '', page.live, '', page.intro.join('\n\n'), ''];
	out.push('To hand the whole job to an agent (Claude Code or Cursor), tell it:', '', '```', page.prompt, '```', '');
	page.sections.forEach((s, i) => {
		out.push(`## ${i + 1}. ${s.title}`, '');
		for (const part of s.parts) {
			if (part.p) out.push(part.p, '');
			else if (part.code != null) out.push(`\`\`\`${part.lang || ''}`, part.code, '```', '');
			else if (part.ol) {
				part.ol.forEach((item, j) => out.push(`${j + 1}. ${item}`));
				out.push('');
			}
		}
		if (s.check) out.push(`Check: ${s.check}`, '');
		if (s.fail) out.push(`If it fails: ${s.fail}`, '');
	});
	out.push(page.footer, '');
	return out.join('\n');
}

/* ---------- HTML (GET /connect) ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `@font-face{font-family:'Plus Jakarta Sans Variable';src:url('/connect/fonts/plus-jakarta-sans-latin-wght-normal.woff2') format('woff2');font-weight:200 800;font-display:swap}
@font-face{font-family:'Fira Code Variable';src:url('/connect/fonts/fira-code-latin-wght-normal.woff2') format('woff2');font-weight:300 700;font-display:swap}
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#07070b;color:#f2f2f6;font:400 16px/1.6 'Plus Jakarta Sans Variable',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem 6rem}
h1{font-size:1.5rem;line-height:1.3;margin:0 0 .4rem;font-weight:650}
h2{font-size:1.15rem;margin:0 0 .5rem;font-weight:650}
h2 .n{color:#a9b1f0;font-weight:500;margin-right:.55rem}
p{margin:.7rem 0;color:#c6c6d0;max-width:62ch}
.live{color:#8a8a96;font-size:.9rem;margin:0 0 1.75rem}
section{border-top:1px solid rgb(242 242 246 / 0.09);margin-top:1.75rem;padding-top:1.5rem}
code{font-family:'Fira Code Variable',ui-monospace,monospace;font-size:.9em}
.cmd{position:relative;margin:.6rem 0}
pre{margin:0;padding:.8rem 3.2rem .8rem 1rem;background:#0c0c12;border:1px solid rgb(242 242 246 / 0.09);border-radius:.75rem;overflow-x:auto;font-family:'Fira Code Variable',ui-monospace,monospace;font-size:.84rem;line-height:1.55;color:#f2f2f6}
.copy{position:absolute;top:.5rem;right:.5rem;padding:.22rem .6rem;background:#12121a;color:#8a8a96;border:1px solid rgb(242 242 246 / 0.13);border-radius:.5rem;font:inherit;font-size:.78rem;cursor:pointer}
.copy:hover{color:#f2f2f6;border-color:rgb(169 177 240 / 0.6)}
.check{color:#8a8a96;font-size:.95rem}
ol{color:#c6c6d0;padding-left:1.4rem}
li{margin:.35rem 0;max-width:62ch}
footer{margin-top:3rem;padding-top:1.25rem;border-top:1px solid rgb(242 242 246 / 0.09);color:#8a8a96;font-size:.9rem}`;

const COPY_SCRIPT = `addEventListener('click',async(e)=>{var b=e.target.closest('.copy');if(!b)return;var el=document.getElementById(b.dataset.copy);if(!el)return;try{await navigator.clipboard.writeText(el.textContent)}catch{var r=document.createRange();r.selectNodeContents(el);var s=getSelection();s.removeAllRanges();s.addRange(r)}b.textContent='copied';setTimeout(()=>{b.textContent='copy'},1400)})`;

function cmdBlock(code, id) {
	return `<div class="cmd"><pre id="${id}"><code>${esc(code)}</code></pre><button class="copy" data-copy="${id}" type="button">copy</button></div>`;
}

export function buildHtml(page) {
	const out = [
		'<!doctype html><html lang="en"><head><meta charset="utf-8" />',
		'<meta name="viewport" content="width=device-width, initial-scale=1" />',
		'<meta name="color-scheme" content="dark" />',
		'<title>Connect agents to this wall</title>',
		`<style>${CSS}</style></head><body><main>`,
		'<h1>Connect agents to this wall</h1>',
		`<p class="live">${esc(page.live)}</p>`,
		...page.intro.map((p) => `<p>${esc(p)}</p>`)
	];
	let n = 0;
	out.push('<p>To hand the whole job to an agent (Claude Code or Cursor), tell it:</p>', cmdBlock(page.prompt, `c${n++}`));
	page.sections.forEach((s, i) => {
		out.push(`<section><h2><span class="n">${i + 1}</span>${esc(s.title)}</h2>`);
		for (const part of s.parts) {
			if (part.p) out.push(`<p>${esc(part.p)}</p>`);
			else if (part.code != null) out.push(cmdBlock(part.code, `c${n++}`));
			else if (part.ol) out.push(`<ol>${part.ol.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>`);
		}
		if (s.check) out.push(`<p class="check">Check: ${esc(s.check)}</p>`);
		if (s.fail) out.push(`<p class="check">If it fails: ${esc(s.fail)}</p>`);
		out.push('</section>');
	});
	out.push(`<footer>${esc(page.footer)}</footer>`, `</main><script>${COPY_SCRIPT}</script></body></html>`);
	return out.join('\n');
}

/* ---------- the route ---------- */

export function createConnectPage({ sessions = () => [], now = () => Date.now(), fontDir = FONT_DIR } = {}) {
	function send(res, status, type, body) {
		res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
		res.end(body);
	}

	function handleHttp(req, res) {
		if (req.method !== 'GET') return false;
		const url = new URL(req.url || '/', 'http://local');
		const page = url.pathname.replace(/\/+$/, '') || '/';
		if (page === '/connect' || page === '/connect.md' || page === '/api/agents/connect') {
			const data = buildConnect({ wall: wallAddress(req.headers), sessions: sessions(), now: now() });
			if (page === '/connect') send(res, 200, 'text/html', buildHtml(data));
			else send(res, 200, 'text/markdown', buildMarkdown(data));
			return true;
		}
		const m = /^\/connect\/fonts\/([\w.-]+\.woff2)$/.exec(url.pathname);
		if (!m) return false;
		const file = FONTS[m[1]];
		if (!file) return send(res, 404, 'text/plain', 'no such font'), true;
		try {
			const body = readFileSync(path.join(fontDir, file));
			res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
			res.end(body);
		} catch {
			// installed without devDependencies: the page falls back to system-ui
			send(res, 404, 'text/plain', 'no such font');
		}
		return true;
	}

	return { handleHttp };
}
