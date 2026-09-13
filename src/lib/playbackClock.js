/**
 * Playback clock for now-playing UI.
 *
 * Cider highlights lyrics against the player's sample time (MusicKit /
 * HTMLAudio currentTime), not against a stale HTTP poll. This kiosk is not
 * an Apple Music client, so it cannot read AMP TTML syllable-lyrics. The
 * analogue we do have is a stamped sample: AirPlay `prgr` RTP clocks at
 * 44100 Hz, MPRIS `playerctl position`, then extrapolate while playing.
 *
 * Heartbeats and polls must refresh liveness (`updatedAt`) without moving
 * `positionAt`. Using `updatedAt` as the sample time rewinds lyrics every
 * second because the position field is still the last `prgr` reading.
 */

export function livePlaybackPosition(track, now = Date.now()) {
	if (!track) return 0;
	const position = Number(track.position) || 0;
	const length = Number(track.length) || 0;
	const sampledAt = Number(track.positionAt) || 0;
	const frozen = length > 0 ? Math.min(Math.max(0, position), length) : Math.max(0, position);
	if (!track.playing || !sampledAt) return frozen;
	const elapsed = Math.max(0, (now - sampledAt) / 1000);
	const next = position + elapsed;
	return length > 0 ? Math.min(next, length) : next;
}

export function activeLyricIndex(lines, position) {
	if (!Array.isArray(lines) || !lines.length) return -1;
	const t = Number(position) || 0;
	let idx = -1;
	for (let i = 0; i < lines.length; i++) {
		if ((Number(lines[i].time) || 0) <= t) idx = i;
		else break;
	}
	return idx;
}

export function activeWordIndex(words, position) {
	if (!Array.isArray(words) || !words.length) return -1;
	const t = Number(position) || 0;
	let idx = -1;
	for (let i = 0; i < words.length; i++) {
		if ((Number(words[i].time) || 0) <= t) idx = i;
		else break;
	}
	return idx;
}

export function lyricsAreSynced(lines) {
	return Array.isArray(lines) && lines.some((line) => Number(line?.time) > 0);
}
