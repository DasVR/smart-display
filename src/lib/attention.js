// When the wall should get your attention, and how hard it tries.
//
// Most of what the wall shows is ambient: it slides in on the island and goes.
// A few moments matter more: a timer finishing, a reminder, an agent blocked
// on a question, severe weather, a chore coming due. Those become attention
// items. Each one keeps a card on the wall, lights the edge, plays its sound
// and plays it again (a little louder each time) until someone acknowledges
// it: a tap on the wall, the phone, the Action button, or saying "got it".
//
// Pure and shared: src/lib/server/attentionHub.js keeps the list, the kiosk
// page plays it, tests/attention.test.mjs pins it down.

/**
 * level      urgent: wakes the panel even in quiet hours, keeps ringing
 *            important: wakes the panel outside quiet hours
 *            gentle: never wakes the panel; one reminder later
 * sound      the library sound (src/lib/sounds/library.js)
 * repeats    seconds after it was raised when the sound plays again
 * every      after the last repeat, keep playing this often (0: stop)
 * soundFor   stop making sound after this many seconds (the card stays)
 * maxFor     forget the item after this many seconds, acknowledged or not
 * wake       turn the panel on: 'always', 'awake-hours' or 'never'
 * quietSound in quiet hours: play the sound anyway (true) or stay silent
 */
export const POLICIES = {
	timer: { level: 'urgent', sound: 'timer', repeats: [6, 12, 18, 30, 45, 60], every: 30, soundFor: 600, maxFor: 900, wake: 'always', quietSound: true },
	severe: { level: 'urgent', sound: 'severe', repeats: [45, 120], every: 300, soundFor: 900, maxFor: 1800, wake: 'always', quietSound: true },
	approval: { level: 'urgent', sound: 'approval', repeats: [20, 45, 90], every: 120, soundFor: 900, maxFor: 1800, wake: 'awake-hours', quietSound: false },
	reminder: { level: 'important', sound: 'reminder', repeats: [30, 90, 180], every: 0, soundFor: 300, maxFor: 1800, wake: 'awake-hours', quietSound: false },
	chore: { level: 'gentle', sound: 'info', repeats: [300], every: 0, soundFor: 600, maxFor: 3600, wake: 'never', quietSound: false }
};

export const KINDS = Object.keys(POLICIES);

/** Each repeat is a little louder than the last, up to twice the first. */
export function boostFor(playCount) {
	return Math.min(2, 1 + Math.max(0, playCount) * 0.2);
}

/**
 * Which notify message (the island's event) deserves an attention item, and
 * of what kind. Null for the ambient ones.
 */
export function attentionKindFor(notify = {}) {
	const k = String(notify.kind || '').toLowerCase();
	if (k === 'alert') return /^timer\b/i.test(String(notify.title || '')) ? 'timer' : 'reminder';
	if (k === 'approval') return 'approval';
	if (k === 'severe-weather') return 'severe';
	if (k === 'chore') return 'chore';
	return null;
}

/** Seconds after raising at which the sound plays (0 is the first time). */
export function soundTimes(policy) {
	const times = [0, ...policy.repeats.filter((s) => s > 0 && s <= policy.soundFor)];
	if (policy.every > 0) {
		const last = times.at(-1);
		for (let t = last + policy.every; t <= policy.soundFor; t += policy.every) times.push(t);
	}
	return times;
}

/**
 * Should the sound play now? `played` is how many times it has played for
 * this item already. Returns the play's index (for boostFor) or -1.
 */
export function nextSound(item, now, played, { quiet = false } = {}) {
	const policy = POLICIES[item.kind];
	if (!policy || item.acked) return -1;
	if (quiet && !policy.quietSound) return -1;
	const age = (now - Date.parse(item.raisedAt)) / 1000;
	const times = soundTimes(policy);
	// how many plays are due by now; play only the latest one we owe, never a backlog
	let due = 0;
	while (due < times.length && times[due] <= age) due++;
	return due > played ? due - 1 : -1;
}

/** Should raising this item turn the panel on? */
export function shouldWake(kind, { quiet = false } = {}) {
	const wake = POLICIES[kind]?.wake;
	return wake === 'always' || (wake === 'awake-hours' && !quiet);
}

/** Order on the wall: urgent first, then newest. */
export function sortAttention(items) {
	const rank = { urgent: 0, important: 1, gentle: 2 };
	return [...items].sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3) || Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
}

/** A spoken acknowledgement: "got it", "okay", "stop the timer", "quiet". */
export const ACK_RE = /^(?:got it|ok(?:ay)?|o\.?k\.?|okay got it|i (?:see|got) it|i heard(?: (?:you|it))?|dismiss(?: (?:it|that|all))?|clear (?:it|that)|stop (?:the |that )?(?:timer|alarm|ringing|beeping|noise|sound)|stop ringing|be quiet|quiet|hush|shh+|enough|thanks|thank you|silence(?: it)?)$/i;
