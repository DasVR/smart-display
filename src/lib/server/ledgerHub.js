/**
 * Keeps the Ledger (src/lib/ledger.js) current and serves it.
 *
 *   GET /api/ledger            { now, soon, past, counts, at }
 *   GET /api/ledger?format=text  one line: "2 need you: …"
 *   WS  { type: 'ledger', ledger }  whenever it changes
 *
 * The hubs keep their own storage. ws-server calls changed() after any of
 * them broadcasts, and a minute tick catches things that move with the
 * clock (a chore turning overdue). Rebuilds are coalesced, so a burst of
 * hub messages makes one ledger.
 */

import { buildLedger, ledgerLine, sameLedger } from '../ledger.js';

export function createLedgerHub({ sources, broadcast, now = () => Date.now(), tickMs = 60_000, debounceMs = 50 }) {
	let current = null;
	let timer = null;
	let tick = null;

	function build() {
		const s = sources();
		return buildLedger({ ...s, now: now() });
	}

	function refresh() {
		timer = null;
		const next = build();
		if (sameLedger(current, next)) {
			current = next;
			return false;
		}
		current = next;
		broadcast({ type: 'ledger', ledger: current });
		return true;
	}

	/** Something a hub owns changed: rebuild shortly. */
	function changed() {
		if (timer) return;
		timer = setTimeout(refresh, debounceMs);
	}

	/** Current, even between a hub's change and the coalesced rebuild. */
	function snapshot() {
		if (timer) {
			clearTimeout(timer);
			refresh();
		}
		if (!current) current = build();
		return current;
	}

	function start() {
		refresh();
		tick = setInterval(refresh, tickMs);
	}
	function stop() {
		clearTimeout(timer);
		clearInterval(tick);
		timer = tick = null;
	}

	async function handleHttp(req, res) {
		if (req.method !== 'GET') return false;
		const url = new URL(req.url, 'http://local');
		if (url.pathname !== '/api/ledger') return false;
		const ledger = snapshot();
		if (url.searchParams.get('format') === 'text') {
			res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end(ledgerLine(ledger));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(ledger));
		}
		return true;
	}

	return { changed, refresh, snapshot, start, stop, handleHttp };
}
