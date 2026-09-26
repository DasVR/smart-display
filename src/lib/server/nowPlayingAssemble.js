import { isBluetoothMprisPlayer, parsePlayerctlMetadata, pickMprisPlayer } from '../mprisPlayers.js';
import { mergeNowPlaying } from './audioNowPlaying.js';

function mprisSample(player, now) {
	if (!player) return null;
	const playing = /playing/i.test(player.status);
	return {
		playing,
		artist: player.artist || 'Unknown artist',
		title: player.title || 'Unknown title',
		album: player.album || '',
		art: player.art || '',
		position: player.position || 0,
		positionAt: now,
		length: player.length || 0,
		player: player.player
	};
}

/** Fold every media program plus AirPlay into one now-playing sample.
 *  `playerError` is a playerctl failure (`missing`, `timeout`, `failed`),
 *  not "nothing is playing". A failed probe must not look like silence. */
export function assembleNowPlaying({
	playersText = '',
	playerError = null,
	airplay = null,
	dropBluetooth = false,
	prefer = '',
	bluetoothError = null,
	now = Date.now()
} = {}) {
	if (playerError) {
		const air = mergeNowPlaying(null, airplay, { bluetoothConnected: true });
		if (air.source === 'airplay') {
			return {
				track: { ...air, degraded: 'playerctl', reason: playerError, unavailable: false },
				prefer
			};
		}
		return {
			track: { playing: false, unavailable: true, reason: playerError },
			prefer
		};
	}

	const picked = pickMprisPlayer(parsePlayerctlMetadata(playersText), { dropBluetooth, prefer });
	const track = mergeNowPlaying(mprisSample(picked, now), airplay, { bluetoothConnected: true });
	const playerName = track.player || picked?.player || '';
	if (bluetoothError && isBluetoothMprisPlayer(playerName)) {
		return {
			track: { ...track, degraded: 'bluetooth', reason: 'bluetooth', unavailable: false },
			prefer: playerName
		};
	}
	return { track, prefer: playerName };
}
