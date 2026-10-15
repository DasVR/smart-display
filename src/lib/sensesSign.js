/**
 * Honest senses: the wall always shows whether its camera and microphone
 * are on, in one small fixed sign that never animates. Anyone in the room
 * can read it, not only whoever set it up.
 *
 *   camera  off | on | down (turned on, but the webcam process isn't answering)
 *   mic     off | on | hearing (transcribing what it heard) | down
 *   notes   true while the wall is taking notes (writing down what it hears)
 *
 * Guest mode is the privacy switch for company: calendar titles read
 * "Busy", agents' commands and folders are hidden, and what the mic heard
 * isn't captioned. It's only ever turned on by hand, from the phone's
 * Senses page; nothing turns it on by itself.
 *
 * Pure: src/lib/components/SensesSign.svelte; tests/senses-sign.test.mjs.
 */

/** From the senses snapshot (sensesHub.snapshot() or the 'senses' message). */
export function sensesSign(s = {}) {
	const settings = s.settings ?? {};
	const online = Boolean(s.online);
	const camera = !settings.camera ? 'off' : online && s.camera?.ok !== false && !s.camera?.error ? 'on' : 'down';
	let mic = 'off';
	if (settings.mic) {
		if (!online || s.mic?.ok === false || s.mic?.error) mic = 'down';
		else mic = s.mic?.state === 'thinking' ? 'hearing' : 'on';
	}
	const notes = Boolean(s.notes?.on);
	return { camera, mic, notes, guest: Boolean(settings.guest), label: signLabel({ camera, mic, notes }) };
}

/** For screen readers and the phone: "Camera on · Microphone on, taking notes". */
export function signLabel({ camera, mic, notes }) {
	const cam = { off: 'Camera off', on: 'Camera on', down: 'Camera not answering' }[camera];
	const m = { off: 'Microphone off', on: 'Microphone on', hearing: 'Microphone hearing you', down: 'Microphone not answering' }[mic];
	return `${cam} · ${m}${notes ? ', taking notes' : ''}`;
}

/** Is there anything to show? Both off and no notes: the sign stays away. */
export function signVisible(sign) {
	return Boolean(sign) && (sign.camera !== 'off' || sign.mic !== 'off' || sign.notes);
}

/** A calendar title as the room should see it. */
export function guestTitle(title, guest) {
	return guest ? 'Busy' : title;
}
