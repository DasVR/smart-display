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
	const url = queue.shift();
	if (!url) {
		playing = null;
		signal(false);
		return;
	}
	const audio = new Audio(url);
	playing = audio;
	audio.volume = 1;
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

/** Queue a clip (a /api/voice/clip/… URL from the server). */
export function speakClip(url) {
	if (typeof window === 'undefined' || !url) return;
	queue.push(url);
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
