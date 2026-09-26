/** MPRIS players behind playerctl. Pure so the kiosk and the phone remote
 *  can share the same "which program is actually playing" rules. */

export const MPRIS_FORMAT =
	'{{playerName}}\x1f{{status}}\x1f{{artist}}\x1f{{title}}\x1f{{album}}\x1f{{mpris:artUrl}}\x1f{{position}}\x1f{{mpris:length}}';

export function isBluetoothMprisPlayer(name = '') {
	return /bluez|bluetooth/i.test(String(name || ''));
}

/** `chromium.instance123` stays Chromium. A dbus-style id keeps the last
 *  segment (`org.mpris.MediaPlayer2.mpv` -> Mpv) instead of the org prefix. */
export function prettyPlayerName(name = '') {
	const raw = String(name || '').trim();
	if (!raw) return '';
	if (isBluetoothMprisPlayer(raw)) return 'Bluetooth';
	const parts = raw.split('.').filter(Boolean);
	const label = parts.length > 2 ? parts[parts.length - 1] : parts[0];
	const word = String(label || raw)
		.replace(/[_-]+/g, ' ')
		.trim();
	return word.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

export function parsePlayerctlMetadata(text = '') {
	const rows = [];
	for (const line of String(text || '').split('\n')) {
		if (!line.trim()) continue;
		const parts = line.split('\x1f');
		if (parts.length < 2) continue;
		const [player, status, artist, title, album, art, position, length] = parts;
		if (!player) continue;
		rows.push({
			player,
			status: status || '',
			artist: artist || '',
			title: title || '',
			album: album || '',
			art: art || '',
			position: Number.parseFloat(position) || 0,
			length: (Number.parseInt(length || '0', 10) || 0) / 1_000_000
		});
	}
	return rows;
}

/** Stick with the program already on screen while it is still playing, so
 *  Spotify and a phone don't trade the deck every poll. A phone's BlueZ
 *  player is dropped only when Bluetooth is confirmed disconnected. */
export function pickMprisPlayer(players, { dropBluetooth = false, prefer = '' } = {}) {
	const eligible = (players || []).filter(
		(player) => player?.player && !(dropBluetooth && isBluetoothMprisPlayer(player.player))
	);
	const playing = eligible.filter((player) => /playing/i.test(player.status));
	const paused = eligible.filter((player) => /paused/i.test(player.status));
	if (prefer) {
		const stuck = playing.find((player) => player.player === prefer);
		if (stuck) return stuck;
	}
	if (playing.length) {
		return playing.find((player) => !isBluetoothMprisPlayer(player.player)) || playing[0];
	}
	if (prefer) {
		const stuck = paused.find((player) => player.player === prefer);
		if (stuck) return stuck;
	}
	if (paused.length) {
		return paused.find((player) => !isBluetoothMprisPlayer(player.player)) || paused[0];
	}
	return null;
}

export function classifyPlayerctlFailure(error) {
	if (!error) return 'failed';
	const stderr = String(error.stderr || '');
	const message = `${error.code || ''} ${error.message || ''} ${stderr}`;
	if (error.code === 'ENOENT' || /ENOENT/.test(message)) return 'missing';
	if (error.killed || error.code === 'ETIMEDOUT' || /ETIMEDOUT|timed out/i.test(message)) return 'timeout';
	if (/No players found/i.test(message)) return 'idle';
	if (Number(error.status) === 1 && !String(error.stdout || '').trim() && !stderr.trim()) return 'idle';
	return 'failed';
}

export function musicFaultMessage(reason) {
	switch (reason) {
		case 'missing':
			return 'Music controls are not installed on the display';
		case 'timeout':
			return 'The music player took too long to answer';
		case 'bluetooth':
			return 'Bluetooth status did not answer, so phone audio may be stuck';
		case 'playerctl':
			return 'Local playback controls did not answer. AirPlay can still play.';
		default:
			return 'The music player did not answer';
	}
}

export function musicFaultFromText(text = '') {
	const raw = String(text || '');
	if (/ENOENT|not found|No such file/i.test(raw)) return 'missing';
	if (/timed? ?out|ETIMEDOUT/i.test(raw)) return 'timeout';
	return 'failed';
}
