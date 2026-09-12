const DUMMY_RE = /\b(dummy|null output|auto-null)\b/i;
const HDMI_RE = /\b(hdmi|displayport|display port)\b/i;
const HEADPHONE_RE = /\bheadphones?\b|\bheadset\b/i;
const USB_RE = /\b(usb|dac)\b/i;
const ANALOG_RE = /\b(analog|speakers?|line out|line-out|headphones?|aux|3\.5)\b/i;

export function isDummySink(name = '') {
	return DUMMY_RE.test(name);
}

export function classifySink(name = '') {
	const n = String(name);
	if (isDummySink(n)) return 'dummy';
	if (HDMI_RE.test(n)) return 'hdmi';
	if (HEADPHONE_RE.test(n)) return 'headphone';
	if (USB_RE.test(n)) return 'usb';
	if (ANALOG_RE.test(n)) return 'analog';
	return 'other';
}

/** Parse `wpctl status` into sink rows `{ id, name, default }`. */
export function parseWpctlStatus(text = '') {
	const lines = String(text).split('\n');
	let inAudio = false;
	let inSinks = false;
	const sinks = [];

	for (const line of lines) {
		if (/^Audio\b/.test(line.trim()) || /^\s*Audio\b/.test(line)) {
			inAudio = true;
			inSinks = false;
			continue;
		}
		if (inAudio && /^(Video|Settings)\b/.test(line.trim())) {
			break;
		}
		if (inAudio && /Sinks:/.test(line) && !/Sink endpoints/.test(line)) {
			inSinks = true;
			continue;
		}
		if (inSinks && /(?:Sources:|Sink endpoints:|Source endpoints:|Filters:|Streams:)/.test(line)) {
			inSinks = false;
			continue;
		}
		if (!inSinks) continue;

		const m = line.match(/^(?:[^\d*]*)(\*)?\s*(\d+)\.\s+(.+?)\s*$/);
		if (!m) continue;
		let name = m[3].replace(/\s*\[.*\]\s*$/, '').trim();
		if (!name) continue;
		sinks.push({
			id: parseInt(m[2], 10),
			name,
			default: Boolean(m[1])
		});
	}

	return sinks;
}

function scoreSink(sink) {
	const kind = classifySink(sink.name);
	if (kind === 'dummy') return -1000;
	let pts = 0;
	if (kind === 'headphone') pts = 110;
	else if (kind === 'analog') pts = 100;
	else if (kind === 'usb') pts = 90;
	else if (kind === 'hdmi') pts = 10;
	else pts = 20;
	if (sink.default) pts += kind === 'hdmi' || kind === 'other' ? 1 : 5;
	return pts;
}

/** Prefer analog/USB/headphone over HDMI; never pick Dummy Output. */
export function pickSpeakerSink(sinks = []) {
	const real = (Array.isArray(sinks) ? sinks : []).filter((s) => !isDummySink(s.name));
	if (!real.length) return null;
	return [...real].sort((a, b) => {
		const diff = scoreSink(b) - scoreSink(a);
		if (diff) return diff;
		return a.id - b.id;
	})[0];
}

export function formatSpeakerReport(pick, sinks = []) {
	if (!pick) {
		return {
			ok: false,
			kind: 'none',
			summary: 'speakers: not found (PipeWire has no real sink; Dummy Output only?)',
			pick: null,
			sinks
		};
	}
	const kind = classifySink(pick.name);
	return {
		ok: kind !== 'dummy',
		kind,
		summary: `speakers: connected via ${pick.name} (${kind})`,
		pick,
		sinks
	};
}
