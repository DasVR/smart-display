// The phone's half of pairing (src/lib/server/pairing.js): it keeps its
// device token and sends it on every /ws connection. When the wall says
// pairing is required, the phone goes to the pair page.

import { base } from '$app/paths';

const KEY = 'wall-device-token';

export function deviceToken() {
	try {
		return localStorage.getItem(KEY) || '';
	} catch {
		return '';
	}
}

export function saveDeviceToken(token) {
	try {
		if (token) localStorage.setItem(KEY, token);
		else localStorage.removeItem(KEY);
	} catch {
		/* private mode: paired for this visit only */
	}
}

/** ws://host/ws, with this phone's token when it has one. */
export function wallSocketUrl(host = location.host) {
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	const token = deviceToken();
	return `${proto}//${host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** Call with every message; sends the phone to pairing when the wall asks.
 *  Returns true when it did. */
export function followPairing(msg) {
	if (msg?.type !== 'pair-required') return false;
	if (typeof location === 'undefined' || /\/remote\/pair\/?$/.test(location.pathname)) return false;
	const next = location.pathname + location.search;
	location.href = `${base}/remote/pair?next=${encodeURIComponent(next)}`;
	return true;
}
