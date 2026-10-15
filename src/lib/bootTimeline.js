/**
 * How long the wall took to come on, stage by stage, from marks taken along
 * the way (all epoch ms):
 *
 *   power      the kernel started (from the system's uptime)
 *   server     the dashboard server's process started
 *   listening  it began answering
 *   kiosk      the browser showed its boot page (static/boot.html)
 *   reached    the boot page first got an answer from the server
 *   page       the wall's own page started loading
 *   awake      the wall opened its eyes (src/lib/wake.js)
 *
 * A page load that didn't come through the boot page (a deploy's reload,
 * someone pressing F5) has no kiosk mark and counts as a reload; the kiosk
 * restarted on its own (server already running) counts as 'kiosk'.
 *
 * Pure: src/lib/server/bootLog.js keeps them; tests/boot-timeline.test.mjs.
 */

export const STAGES = [
	['power', 'Power on (kernel starts)'],
	['server', 'Server process starts'],
	['listening', 'Server answering'],
	['kiosk', 'Browser shows the boot screen'],
	['reached', 'Boot screen reaches the server'],
	['page', 'Wall page starts loading'],
	['awake', 'Wall awake']
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** A record from the marks, with only sane numbers kept. */
export function bootRecord(marks = {}, at = Date.now()) {
	const rec = { at };
	for (const [key] of STAGES) if (finite(marks[key])) rec[key] = Math.round(marks[key]);
	rec.kind = rec.kiosk ? 'boot' : 'reload';
	return rec;
}

/** [{ key, label, at (ms after the first mark), step (ms since the one before) }] in time order. */
export function bootStages(rec = {}) {
	const marks = STAGES.filter(([k]) => finite(rec[k]))
		.map(([key, label]) => ({ key, label, t: rec[key] }))
		.sort((a, b) => a.t - b.t);
	if (!marks.length) return [];
	const start = marks[0].t;
	let prev = start;
	return marks.map((m) => {
		const out = { key: m.key, label: m.label, at: m.t - start, step: m.t - prev };
		prev = m.t;
		return out;
	});
}

/** "12.4 s" / "850 ms". */
export function seconds(ms) {
	if (!Number.isFinite(ms)) return '';
	return Math.abs(ms) < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The record as readable lines, the slowest step marked. */
export function describeBoot(rec = {}) {
	const stages = bootStages(rec);
	if (!stages.length) return ['No marks.'];
	const slowest = stages.slice(1).reduce((a, b) => (b.step > (a?.step ?? -1) ? b : a), null);
	const lines = stages.map((s) => `${seconds(s.at).padStart(8)}  ${s.label}${s === slowest && s.step > 0 ? `   ← slowest step (${seconds(s.step)})` : ''}`);
	const from = { boot: 'from power on', kiosk: 'kiosk restart', reload: 'page reload' }[rec.kind] || '';
	lines.push(`Total: ${seconds(stages.at(-1).at)}${from ? ` (${from})` : ''}`);
	return lines;
}
