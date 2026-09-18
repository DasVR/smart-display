import { displayLyricWords } from '../lyricWords.js';
import {
	alignEngineInfo,
	ensureAlignedLyrics,
	forgetCachedAlignment,
	isAlignmentInFlight,
	isPreciseEngine,
	readCachedAlignmentInfo,
	trackFingerprint
} from './forcedAlign.js';
import { getNowPlaying, pickDisplayLyrics } from './hostData.js';
import {
	hasRealWordTiming,
	lyricsCacheKey,
	lyricsToPlainText,
	peekLyricsInfo,
	seedLyricsCache
} from './lyrics.js';
import { deleteLyricPick, getLyricPick, putLyricPick } from './lyricsStore.js';

export function providerLabel(id) {
	const key = String(id || '');
	if (!key) return 'None';
	if (key === 'community') return 'Community';
	if (key.startsWith('align:')) {
		const engine = key.slice(6);
		if (engine === 'qwen') return 'Qwen aligner';
		if (engine === 'energy') return 'Energy guess';
		if (engine === 'ctc') return 'CTC aligner';
		if (engine === 'aeneas') return 'Aeneas';
		if (engine === 'mfa') return 'MFA';
		return `Align (${engine})`;
	}
	if (key === 'amll-ttml') return 'AMLL TTML';
	if (key === 'kugou-krc') return 'Kugou KRC';
	if (key === 'netease-yrc') return 'NetEase YRC';
	if (key === 'lrclib-synced') return 'LRCLIB synced';
	if (key === 'lrclib-plain') return 'LRCLIB plain';
	if (key === 'musixmatch') return 'Musixmatch';
	return key;
}

function compactLine(line) {
	const words = displayLyricWords(line).map((word) => ({
		time: Number(word.time) || 0,
		end: Number.isFinite(Number(word.end)) ? Number(word.end) : undefined,
		text: String(word.text || '')
	}));
	const last = words[words.length - 1];
	return {
		time: Number(line?.time) || 0,
		end: Number(line?.end) || last?.end,
		text: String(line?.text || words.map((w) => w.text).join(' ')),
		wordCount: words.length,
		words
	};
}

function compactLines(lines) {
	if (!Array.isArray(lines)) return [];
	return lines.filter((line) => line?.text || line?.words?.length).map(compactLine);
}

export function availableLyricProviders({ community, aligned } = {}) {
	const providers = [];
	if (community?.lines?.length) {
		const id = community.source || 'community';
		if (!(String(id).startsWith('align:') && aligned?.lines?.length)) {
			providers.push({
				id,
				kind: 'community',
				label: providerLabel(id),
				wordLevel: Boolean(community.wordLevel) || hasRealWordTiming(community.lines),
				precise: false,
				lineCount: community.lines.length,
				lines: compactLines(community.lines)
			});
		}
	}
	if (aligned?.lines?.length) {
		const id = `align:${aligned.engine || 'unknown'}`;
		providers.push({
			id,
			kind: 'align',
			label: providerLabel(id),
			wordLevel: hasRealWordTiming(aligned.lines),
			precise: Boolean(aligned.precise) || isPreciseEngine(aligned.engine),
			engine: aligned.engine || null,
			lineCount: aligned.lines.length,
			lines: compactLines(aligned.lines)
		});
	}
	return providers;
}

function trackFromNowPlaying(np) {
	if (!np?.title) return null;
	return {
		artist: np.artist || '',
		title: np.title || '',
		album: np.album || '',
		duration: Number(np.length) || 0,
		position: Number(np.position) || 0,
		playing: Boolean(np.playing),
		paused: Boolean(np.paused),
		lyricsSource: np.lyricsSource || null
	};
}

export async function getLyricMonitor() {
	const np = await getNowPlaying();
	const track = trackFromNowPlaying(np);
	const engine = alignEngineInfo() || { engine: 'energy', precise: false, available: ['energy'] };
	if (!track) {
		return {
			track: null,
			displaySource: null,
			pick: null,
			engine,
			inFlight: false,
			providers: []
		};
	}
	const peeked = peekLyricsInfo(track.artist, track.title, track.album, track.duration);
	const fp = trackFingerprint(track.artist, track.title, track.duration);
	const aligned = readCachedAlignmentInfo(fp);
	const key = lyricsCacheKey(track.artist, track.title, track.album, track.duration);
	const pick = getLyricPick(key);
	const chosen = pickDisplayLyrics({ community: peeked, aligned, pick });
	return {
		track,
		fingerprint: fp,
		cacheKey: key,
		displaySource: chosen.source,
		pick,
		engine,
		inFlight: isAlignmentInFlight(fp),
		providers: availableLyricProviders({ community: peeked, aligned })
	};
}

export async function applyLyricAction({ action, source } = {}) {
	const np = await getNowPlaying();
	const track = trackFromNowPlaying(np);
	if (!track) return { ok: false, error: 'nothing playing' };
	const peeked = peekLyricsInfo(track.artist, track.title, track.album, track.duration);
	const fp = trackFingerprint(track.artist, track.title, track.duration);
	const aligned = readCachedAlignmentInfo(fp);
	const key = lyricsCacheKey(track.artist, track.title, track.album, track.duration);
	const current = getLyricPick(key) || {
		artist: track.artist,
		title: track.title,
		album: track.album,
		duration: track.duration,
		displaySource: null,
		cacheSource: null,
		pinned: false
	};
	const providers = availableLyricProviders({ community: peeked, aligned });
	const wanted = String(source || '');
	const hit = wanted ? providers.find((provider) => provider.id === wanted) : null;

	if (action === 'unpin') {
		deleteLyricPick(key);
		return getLyricMonitor();
	}

	if (action === 'realign') {
		forgetCachedAlignment(fp);
		if (peeked.plainText) {
			ensureAlignedLyrics({
				artist: track.artist,
				title: track.title,
				duration: track.duration,
				plainLyrics: peeked.plainText,
				position: track.position,
				communityWordLevel: peeked.wordLevel,
				engine: alignEngineInfo()
			});
		}
		return getLyricMonitor();
	}

	if (!hit) return { ok: false, error: 'unknown source' };

	if (action === 'display') {
		putLyricPick(key, {
			...current,
			artist: track.artist,
			title: track.title,
			album: track.album,
			duration: track.duration,
			displaySource: hit.id,
			pinned: false,
			updatedAt: Date.now()
		});
		return getLyricMonitor();
	}

	if (action === 'pin') {
		putLyricPick(key, {
			...current,
			artist: track.artist,
			title: track.title,
			album: track.album,
			duration: track.duration,
			displaySource: hit.id,
			pinned: true,
			updatedAt: Date.now()
		});
		return getLyricMonitor();
	}

	if (action === 'cache') {
		const lines = hit.kind === 'align' ? aligned.lines : peeked.lines;
		seedLyricsCache(track.artist, track.title, {
			album: track.album,
			duration: track.duration,
			source: hit.id,
			lines,
			wordLevel: hit.wordLevel,
			plainText: lyricsToPlainText(lines)
		});
		putLyricPick(key, {
			...current,
			artist: track.artist,
			title: track.title,
			album: track.album,
			duration: track.duration,
			cacheSource: hit.id,
			displaySource: current.displaySource || hit.id,
			updatedAt: Date.now()
		});
		return getLyricMonitor();
	}

	return { ok: false, error: 'unknown action' };
}
