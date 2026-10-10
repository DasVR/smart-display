/** Canonical kiosk channel order. Keep the page strip, phone remote, and
 *  websocket swipe list on this one list so a new tab cannot land in only
 *  one of the three. */

export const KIOSK_VIEWS = ['clock', 'calendar', 'agents', 'music', 'weather'];

export const KIOSK_VIEW_LABELS = {
	clock: 'Clock',
	calendar: 'Calendar',
	agents: 'Agents',
	music: 'Music',
	weather: 'Weather'
};

export function kioskViewLabel(id) {
	return KIOSK_VIEW_LABELS[id] || String(id || '');
}

/** Retired channels map to their successors: `dev` is Agents, `school` is
 *  Calendar (Home Assistant automations may still send it). Unknown values
 *  fall back to clock. */
export function canonicalizeKioskView(id) {
	if (id === 'dev') return 'agents';
	if (id === 'school') return 'calendar';
	if (KIOSK_VIEWS.includes(id)) return id;
	return 'clock';
}

export function swipeKioskView(current, dir) {
	const n = KIOSK_VIEWS.length;
	let idx = KIOSK_VIEWS.indexOf(canonicalizeKioskView(current));
	if (idx < 0) idx = 0;
	if (dir === 'left') idx = (idx + 1) % n;
	if (dir === 'right') idx = (idx - 1 + n) % n;
	return KIOSK_VIEWS[idx];
}
