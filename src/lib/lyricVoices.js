/** Apple Music / AMLL TTML often stamps more than one voice on a beat:
 *  a lead line, a reply from another singer, and a short chorus echo
 *  (`ttm:role="x-bg"` or a parenthetical that starts during the lead).
 *  Flattening those into one stack made call-and-response read as a
 *  single sequential karaoke. */

const PAREN_LINE_RE = /^\s*[\(\[\{].+[\)\]\}]\s*$/;

function wordCount(text) {
	return String(text || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
}

/** Last clock this line is still singing. Prefer the last word's end so a
 *  TTML `<p end>` that lands on the next row does not look like overlap. */
function lastSungTime(line, nextTime) {
	const start = Number(line?.time) || 0;
	const words = line?.words;
	if (Array.isArray(words) && words.length) {
		const last = words[words.length - 1];
		const end = Number(last.end);
		if (Number.isFinite(end) && end > start) return end;
		const t = Number(last.time);
		if (Number.isFinite(t)) return t + 0.55;
	}
	const stamped = Number(line?.end);
	if (Number.isFinite(stamped) && stamped > start) return stamped;
	const next = Number(nextTime);
	if (Number.isFinite(next) && next > start) return Math.min(next, start + 2.4);
	return start + 2.4;
}

function looksLikeChorusEcho(prev, line) {
	if (line?.role === 'bg' || line?.part === 'bg') return true;
	if (line?.part === 'reply' || line?.side === 'right') return false;
	const text = String(line?.text || '').trim();
	if (!text || !prev?.text) return false;
	if (line.agent && prev.agent && line.agent !== prev.agent) return false;
	const n = wordCount(text);
	const prevN = wordCount(prev.text);
	const start = Number(line.time) || 0;
	const prevStart = Number(prev.time) || 0;
	const prevEnd = lastSungTime(prev, start);
	const during = start < prevEnd - 0.02;
	const rightAfter = start - prevEnd <= 0.55 && start >= prevStart;
	// Parentheticals can sit just after the lead. Other short lines only
	// tuck under while the lead is still singing - a 2-word next verse
	// is just the next karaoke row.
	if (PAREN_LINE_RE.test(text) && (during || rightAfter)) return true;
	if (!during) return false;
	if (n <= 2 && n < prevN) return true;
	return n <= 3 && n <= Math.max(1, Math.floor(prevN * 0.45));
}

function asBackgroundPart(line) {
	const part = {
		time: Number(line.time) || 0,
		text: String(line.text || '').trim()
	};
	const end = Number(line.end);
	if (Number.isFinite(end) && end > part.time) part.end = end;
	if (Array.isArray(line.words) && line.words.length) part.words = line.words;
	return part;
}

/** Simultaneous singing, not turn-taking. Back-to-back vocals often share
 *  a 50-200ms clock abutment or a `<p end>` that equals the next begin. */
const MIN_CONVERSATION_OVERLAP_SEC = 0.45;

function overlapsConversation(prev, line) {
	if (!prev?.text || !line?.text) return false;
	const start = Number(line.time) || 0;
	const prevStart = Number(prev.time) || 0;
	if (!(start > prevStart)) return false;
	const prevEnd = lastSungTime(prev, start);
	return prevEnd - start >= MIN_CONVERSATION_OVERLAP_SEC;
}

function assignConversationSides(lines) {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line?.text) continue;
		const prev = lines[i - 1];
		if (prev?.text && overlapsConversation(prev, line)) {
			const prevRight = prev.side === 'right';
			line.side = prevRight ? 'left' : 'right';
			line.part = line.part || (line.side === 'right' ? 'reply' : 'lead');
			if (!prev.side) prev.side = 'left';
			if (!prev.part) prev.part = 'lead';
		} else {
			line.side = line.side || 'left';
			line.part = line.part || 'lead';
		}
	}
}

/** Fold chorus echoes under the lead they belong to, and mark overlapping
 *  voices so the stack can stagger a back-and-forth instead of treating
 *  every line as the next solo karaoke row. */
export function annotateLyricVoices(lines) {
	const src = Array.isArray(lines) ? lines : [];
	const out = [];
	for (let i = 0; i < src.length; i++) {
		const line = { ...src[i] };
		if (Array.isArray(line.background) && line.background.length) {
			line.background = line.background.map((part) => ({ ...part }));
		}
		const prev = out[out.length - 1];
		if (looksLikeChorusEcho(prev, line)) {
			const extras = [...(line.background || []), asBackgroundPart(line)].filter((part) => part.text);
			prev.background = [...(prev.background || []), ...extras];
			continue;
		}
		out.push(line);
	}
	assignConversationSides(out);
	return out;
}

export function isLyricReply(line) {
	return line?.part === 'reply' || line?.side === 'right';
}
