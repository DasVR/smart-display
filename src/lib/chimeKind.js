/** Pick which playChime() profile an island/remote event should use.
 *  Kept free of AudioContext so tests can assert mapping without a window. */

export function volumeTickPitch(level) {
	const v = Number(level);
	if (!Number.isFinite(v)) return 0.45;
	return Math.min(1, Math.max(0, v));
}

export function chimeKindForEvent({
	kind = '',
	source = '',
	severity = 'info',
	muted = false,
	title = ''
} = {}) {
	const k = String(kind || '').toLowerCase();
	const src = String(source || '').toLowerCase();
	const sev = String(severity || 'info');

	if (k === 'severe-weather') return 'severe';
	if (k === 'volume') return muted ? 'mute' : 'volume';
	if (k === 'mute') return 'mute';
	if (k === 'schedule') return 'schedule';
	if (k === 'install') return 'install';
	if (k === 'update') return sev === 'ok' ? 'success' : 'update';
	if (k === 'done' || /\bfinished$/i.test(String(title || ''))) {
		if (src.includes('cursor')) return 'done-cursor';
		if (src.includes('claude')) return 'done-claude';
		if (src.includes('hermes')) return 'done-hermes';
		if (src.includes('ollama')) return 'done-ollama';
		return 'success';
	}
	if (k === 'music') return 'music';
	if (k === 'briefing') return 'info';
	if (sev === 'ok' || sev === 'warn' || sev === 'error' || sev === 'info') return sev;
	return 'info';
}
