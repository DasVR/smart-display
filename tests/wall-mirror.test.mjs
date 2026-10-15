import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorFor, whenText } from '../src/lib/wallMirror.js';
import { buildLedger } from '../src/lib/ledger.js';

// 10:00 AM in New York (the wall's clock), Thursday 15 Oct 2026
const NOW = Date.parse('2026-10-15T14:00:00Z');
const iso = (minutes) => new Date(NOW + minutes * 60_000).toISOString();

const ledger = buildLedger({
	tasks: [
		{ id: 'bins', title: 'Take out the bins', kind: 'chore', status: 'overdue', nextDue: iso(-30) },
		{ id: 'cat', title: 'Feed the cat', kind: 'chore', status: 'today', nextDue: iso(390) },
		{ id: 'gym', title: 'Gym', kind: 'alert', status: 'upcoming', nextDue: iso(60 * 24) }
	],
	approvals: [{ id: 'p1', source: 'Cursor', title: 'Apply edit?', detail: 'wallActions.js +12 −3', status: 'pending', createdAt: iso(-1), expiresAt: iso(2) }],
	attention: [{ id: 'a1', kind: 'chore', title: 'Take out the bins', ref: 'task:bins', raisedAt: iso(-1) }],
	alerts: [{ id: 'w', event: 'Severe Thunderstorm Warning', headline: 'Until 11 AM', tier: 'warning', expires: iso(60) }],
	day: { agents: [{ source: 'Claude Code', at: iso(-45) }] },
	now: NOW
});

test('whenText reads on the wall clock', () => {
	assert.equal(whenText(iso(390), NOW), '4:30 PM');
	assert.equal(whenText(iso(60 * 24), NOW), 'Tomorrow 10 AM');
	assert.equal(whenText(iso(60 * 48), NOW), 'Sat 10 AM');
	assert.equal(whenText(iso(60), NOW, true), 'Today');
	assert.equal(whenText(null, NOW), '');
});

test('clock: what needs you with its buttons, then the next thing', () => {
	const m = mirrorFor({ view: 'clock', ledger, now: NOW });
	assert.equal(m.title, 'Clock');
	assert.deepEqual(m.rows.map((r) => r.text), ['Take out the bins', 'Severe Thunderstorm Warning', 'Cursor: Apply edit?', 'Next: Feed the cat']);
	const bins = m.rows[0];
	assert.equal(bins.calling, true);
	assert.deepEqual(bins.actions, [
		{ kind: 'task', op: 'done', id: 'bins', label: 'Done' },
		{ kind: 'task', op: 'snooze', id: 'bins', label: 'Later' }
	], 'Done answers the ring too, so no separate Got it');
	assert.deepEqual(m.rows[2].actions.map((a) => a.label), ['Allow', 'Deny']);
	assert.equal(mirrorFor({ view: 'clock', ledger: null }).empty, 'Nothing needs you.');
});

test('agents: who is waiting, then recent runs', () => {
	const m = mirrorFor({ view: 'agents', ledger, now: NOW });
	assert.deepEqual(m.rows.map((r) => r.text), ['Cursor: Apply edit?', 'Claude Code finished']);
	assert.equal(m.rows[0].sub, 'wallActions.js +12 −3');
	assert.deepEqual(m.rows[0].actions[0], { kind: 'approval', decision: 'allow', id: 'p1', label: 'Allow' });
});

test('music: the track and the transport', () => {
	const m = mirrorFor({ view: 'music', nowPlaying: { title: 'Holocene', artist: 'Bon Iver', album: 'Bon Iver', playing: true }, now: NOW });
	assert.equal(m.rows[0].text, 'Holocene');
	assert.equal(m.rows[0].sub, 'Bon Iver · Bon Iver');
	assert.deepEqual(m.controls.map((c) => c.label), ['Previous', 'Pause', 'Next']);
	const idle = mirrorFor({ view: 'music', nowPlaying: { playing: false, unavailable: true } });
	assert.equal(idle.empty, 'Nothing is playing.');
	assert.deepEqual(idle.controls, []);
});

test('calendar and weather', () => {
	assert.deepEqual(mirrorFor({ view: 'calendar', ledger, now: NOW }).rows.map((r) => r.text), ['Feed the cat', 'Gym']);
	const w = mirrorFor({ view: 'weather', ledger, weather: { current: { temp: 71.6, desc: 'Thunderstorm', windSpeed: 14.2 } }, now: NOW });
	assert.deepEqual(w.rows.map((r) => r.text), ['72° Thunderstorm', 'Severe Thunderstorm Warning']);
	assert.equal(w.rows[0].sub, 'Wind 14 mph');
	assert.equal(mirrorFor({ view: 'weather', ledger: null }).empty, 'No weather alerts.');
});
