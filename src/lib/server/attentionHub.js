/**
 * The wall's attention list (policy: src/lib/attention.js).
 *
 * Items come from what the wall already announces: raise() is called with
 * the island's notify messages (a timer or reminder coming due, an agent
 * asking, a chore due) and with severe weather from the kiosk. Each one stays
 * until it's acknowledged, the thing behind it is dealt with (the chore
 * ticked off, the approval answered), or it ages out.
 *
 * Raising an urgent or important item turns the panel on if it was off
 * (wake). When the last item goes, a panel the list woke goes back off a
 * minute later (restore), unless someone changed it in the meantime.
 *
 * Everyone sees the same list: { type: 'attention', items } is broadcast on
 * every change, and the kiosk, the phone, the Action button and "got it" all
 * acknowledge through ack().
 */
import { POLICIES, attentionKindFor, shouldWake, sortAttention } from '../attention.js';

const RESTORE_MS = 60000;

// Agents relayed through a gateway can arrive still wearing its wire format:
// `Hermes [2026-10-22 09:15:44] "Timer: Pasta"`. On the island that's just
// `Timer: Pasta` — the source has its own field, so the wrap is dropped. The
// stamp must hold a clock time, so `Timer: Pasta [note]` is left alone.
const WIRE_STAMP = /^(?:[A-Za-z][\w.-]{0,29}:? )?\[(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}[T ]?)?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,6})?(?: ?(?:Z|[+-]\d{2}:?\d{2}))?\] */;
const WIRE_QUOTES = { '"': '"', "'": "'", '“': '”', '‘': '’' };

function unquote(text) {
	if (text.length >= 2 && WIRE_QUOTES[text[0]] === text.at(-1)) return text.slice(1, -1).trim();
	return text;
}

/** An item's title/body without the gateway's wire wrap. */
function unwrapWire(value) {
	let text = String(value || '').replace(/\s+/g, ' ').trim();
	for (let round = 0; round < 3; round++) {
		const before = text;
		text = unquote(text);
		const stamped = WIRE_STAMP.exec(text);
		if (stamped) text = unquote(text.slice(stamped[0].length));
		if (text === before) break;
	}
	return text;
}

export function createAttentionHub({
	broadcast = () => {},
	now = () => Date.now(),
	isQuiet = () => false,
	wake = async () => false, // turn the panel on; resolves true if it was off
	restore = async () => {}, // turn it back off
	restoreMs = RESTORE_MS,
	log = console
} = {}) {
	let items = [];
	let seq = 0;
	let woke = false;
	let restoreTimer = null;
	let lastWake = Promise.resolve();
	const expiries = new Map();

	function snapshot() {
		return sortAttention(items).map((i) => ({ ...i }));
	}

	function changed() {
		broadcast({ type: 'attention', items: snapshot() });
		if (items.length) {
			clearTimeout(restoreTimer);
			restoreTimer = null;
		} else if (woke && !restoreTimer) {
			restoreTimer = setTimeout(() => {
				restoreTimer = null;
				if (items.length || !woke) return;
				woke = false;
				Promise.resolve(restore()).catch(() => {});
			}, restoreMs);
			restoreTimer.unref?.();
		}
	}

	function drop(id) {
		clearTimeout(expiries.get(id));
		expiries.delete(id);
		items = items.filter((i) => i.id !== id);
	}

	/**
	 * Raise an item: { kind, title, body?, ref? }. `ref` ties it to what it's
	 * about (task:<id>, approval:<id>, weather:<event>), so the same thing is
	 * never raised twice and goes away when that thing is settled.
	 */
	function raise({ kind, title, body = '', ref = '' } = {}) {
		const policy = POLICIES[kind];
		const heading = unwrapWire(title);
		if (!policy || !heading) return null;
		if (ref) {
			const twin = items.find((i) => i.ref === ref);
			if (twin) return twin;
		}
		const quiet = isQuiet();
		const item = {
			id: `a${++seq}`,
			kind,
			level: policy.level,
			sound: policy.sound,
			title: heading.slice(0, 120),
			body: unwrapWire(body).slice(0, 240),
			ref: String(ref || ''),
			raisedAt: new Date(now()).toISOString(),
			quiet
		};
		items = [...items, item];
		const t = setTimeout(() => {
			if (items.some((i) => i.id === item.id)) {
				drop(item.id);
				changed();
			}
		}, policy.maxFor * 1000);
		t.unref?.();
		expiries.set(item.id, t);
		changed();
		if (shouldWake(kind, { quiet })) {
			lastWake = Promise.resolve()
				.then(() => wake())
				.then((wasOff) => {
					if (wasOff) woke = true;
				})
				.catch((err) => log.warn?.(`[attention] wake failed: ${err?.message || err}`));
		}
		return item;
	}

	/** From the island's notify message, when it deserves attention. */
	function fromNotify(msg = {}) {
		const kind = attentionKindFor(msg);
		if (!kind) return null;
		const ref = msg.taskId ? `task:${msg.taskId}` : msg.approvalId ? `approval:${msg.approvalId}` : '';
		return raise({ kind, title: msg.title, body: msg.body, ref });
	}

	/** Acknowledge one item, or all of them (no id). Returns how many went. */
	function ack(id) {
		const before = items.length;
		for (const i of [...items]) if (!id || i.id === id) drop(i.id);
		const gone = before - items.length;
		if (gone) changed();
		return gone;
	}

	/** Chores ticked off or snoozed, from the task list. */
	function syncTasks(tasks = []) {
		const waiting = new Set(tasks.filter((t) => t.status === 'due' || t.status === 'overdue').map((t) => `task:${t.id}`));
		const known = new Set(tasks.map((t) => `task:${t.id}`));
		let gone = 0;
		for (const i of [...items]) {
			// alerts are settled the moment they fire, so only chores follow the list
			if (i.kind === 'chore' && i.ref.startsWith('task:') && (!waiting.has(i.ref) || !known.has(i.ref))) {
				drop(i.id);
				gone++;
			}
		}
		if (gone) changed();
	}

	/** Approvals answered or expired. */
	function syncApprovals(approvals = []) {
		const pending = new Set(approvals.filter((a) => !a.status || a.status === 'pending').map((a) => `approval:${a.id}`));
		let gone = 0;
		for (const i of [...items]) {
			if (i.kind === 'approval' && i.ref && !pending.has(i.ref)) {
				drop(i.id);
				gone++;
			}
		}
		if (gone) changed();
	}

	/** The thing behind an item is over (a warning expired or was cancelled). */
	function settle(ref) {
		const item = items.find((i) => i.ref === ref);
		if (!item) return false;
		drop(item.id);
		changed();
		return true;
	}

	/**
	 * The same thing, newly described (NWS updates a warning under a new id):
	 * keep the item and how long it's been ringing, just follow the new ref.
	 * Nothing happens if it was already answered.
	 */
	function rekey(fromRef, toRef, { title, body } = {}) {
		const item = items.find((i) => i.ref === fromRef);
		if (!item) return false;
		item.ref = toRef;
		if (title) item.title = String(title).replace(/\s+/g, ' ').trim().slice(0, 120);
		if (body !== undefined) item.body = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 240);
		changed();
		return true;
	}

	/** Someone turned the panel on or off by hand: it's theirs now, don't restore it. */
	function panelChanged() {
		woke = false;
		clearTimeout(restoreTimer);
		restoreTimer = null;
	}

	function stop() {
		for (const t of expiries.values()) clearTimeout(t);
		expiries.clear();
		clearTimeout(restoreTimer);
	}

	/** Resolves once the panel is on (if raising turned it on), so speech isn't said to a dark room. */
	function awake() {
		return lastWake;
	}

	return { raise, fromNotify, ack, settle, rekey, syncTasks, syncApprovals, panelChanged, awake, snapshot, stop, count: () => items.length };
}
