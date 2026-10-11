// Plays what the wall says (server `speak` messages, src/lib/server/voiceHub.js)
// one clip at a time, and tells the page while it's talking with a
// `wall-speaking` window event ({ detail: true | false }), which lights
// the edge glow.

const queue = [];
let playing = null;

function signal(on) {
	if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wall-speaking', { detail: on }));
}

function next() {
	const item = queue.shift();
	if (!item) {
		playing = null;
		signal(false);
		return;
	}
	const audio = new Audio(item.url);
	playing = audio;
	// the voice's own level (day or night, from the server); the speaker volume isn't touched
	audio.volume = item.volume;
	const done = () => {
		audio.onended = audio.onerror = null;
		if (playing === audio) next();
	};
	audio.onended = done;
	audio.onerror = done;
	signal(true);
	// autoplay can still be blocked before the first touch on the kiosk;
	// the caption has already shown, so just move on
	audio.play().catch(done);
}

/** Queue a clip (a /api/voice/clip/… URL from the server) at a volume from 0 to 1. */
export function speakClip(url, volume = 1) {
	if (typeof window === 'undefined' || !url) return;
	const v = Number(volume);
	queue.push({ url, volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1 });
	if (queue.length > 4) queue.splice(0, queue.length - 4); // never a backlog
	if (!playing) next();
}

/** Stop talking now (screen off, sleep). */
export function hushWall() {
	queue.length = 0;
	if (playing) {
		playing.onended = playing.onerror = null;
		playing.pause();
		playing = null;
		signal(false);
	}
}
