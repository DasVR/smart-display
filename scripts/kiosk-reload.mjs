#!/usr/bin/env node
// Reload the wall's page in the running kiosk browser, through its DevTools
// port (start-kiosk.sh opens 9222 on localhost), instead of restarting cage
// and Chromium. A deploy then goes black for no time at all: the page wakes
// up again (src/lib/wake.js) with the new build. Exits 1 if it couldn't, and
// scripts/deploy.sh restarts the kiosk as before.
//
//   node scripts/kiosk-reload.mjs [http://localhost:3000]

const WALL = (process.argv[2] || process.env.WALL_URL || 'http://localhost:3000').replace(/\/+$/, '');
const DEVTOOLS = process.env.KIOSK_DEVTOOLS || 'http://127.0.0.1:9222';

export async function reload({ wall = WALL, devtools = DEVTOOLS, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, timeout = 5000 } = {}) {
	const targets = await (await fetchImpl(`${devtools}/json/list`, { signal: AbortSignal.timeout(timeout) })).json();
	const page = targets.find((t) => t.type === 'page' && (t.url.startsWith(wall) || t.url.startsWith('file:')));
	if (!page?.webSocketDebuggerUrl) throw new Error('no wall page in the kiosk browser');
	const ws = new WebSocketImpl(page.webSocketDebuggerUrl);
	return await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error('the kiosk browser did not answer'));
		}, timeout);
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error('could not reach the kiosk browser'));
		};
		ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: `${wall}/` } }));
		ws.onmessage = (ev) => {
			const msg = JSON.parse(String(ev.data));
			if (msg.id !== 1) return;
			clearTimeout(timer);
			ws.close();
			if (msg.error || msg.result?.errorText) reject(new Error(msg.error?.message || msg.result.errorText));
			else resolve(page.url);
		};
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	reload()
		.then((from) => {
			console.log(`reloaded the wall's page (was ${from})`);
			process.exit(0);
		})
		.catch((e) => {
			console.error(`kiosk reload: ${e.message}`);
			process.exit(1);
		});
}
