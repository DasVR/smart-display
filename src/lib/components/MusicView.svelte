<script>
	import { onMount } from 'svelte';
	import { nowPlaying } from '$lib/stores.js';
	import { bassLevel } from '$lib/services/audioReactive.js';
	import {
		activeLyricIndex as startedIndexForTime,
		activeWordIndex,
		easeToward,
		instrumentalDotStatesFromGap,
		instrumentalRest,
		HELD_WORD_SEC,
		isHeldWord,
		isPlaybackJump,
		letterFill,
		letterWave,
		livePlaybackPosition,
		LYRIC_LEAD_SEC,
		lyricsAreSynced,
		lineSungThrough,
		isLineSinging,
		STACK_EASE_TAU_SEC,
		wordProgress
	} from '$lib/playbackClock.js';
	import { rememberNowPlaying } from '$lib/artCarousel.js';
	import { shouldGlueLyricTokens } from '$lib/lyricWords.js';
	import { isLyricReply } from '$lib/lyricVoices.js';
	import { applyTransportOptimistic, nudgeNowPlaying } from '$lib/services/nowPlayingSync.js';

	let artFailed = $state(false);
	let lastArtUrl = null;
	let displayPosition = $state(0);
	let lyricsOffset = $state(0);
	let raf = 0;
	let lyricsViewport = $state(null);
	let reducedMotion = $state(false);
	let snapLyrics = $state(false);
	let lastSample = null;
	let lastEaseAt = 0;
	let stackReady = false;
	let lastTrackKey = '';
	let carousel = $state({ prev: null, current: null, next: null });

	let track = $derived($nowPlaying);
	let hasTrack = $derived(Boolean(track?.title || track?.playing || track?.paused));
	let trackKey = $derived(`${track?.artist ?? ''}::${track?.title ?? ''}`);
	let synced = $derived(lyricsAreSynced(track?.lyrics) ? track.lyrics : null);
	let plainLyrics = $derived(!synced && track?.lyrics?.[0]?.text ? track.lyrics[0].text : null);
	let lyricsPending = $derived(Boolean(track?.lyricsPending) && !synced && !plainLyrics);
	let lyricClock = $derived(track?.playing ? displayPosition + LYRIC_LEAD_SEC : displayPosition);
	let startedLyricIndex = $derived(startedIndexForTime(synced, lyricClock));
	let rest = $derived(instrumentalRest(synced, lyricClock, track?.length));
	let focusLyricIndex = $derived.by(() => {
		if (!synced?.length) return -1;
		for (let i = 0; i < synced.length; i++) {
			if (isLineSinging(synced[i], lyricClock, synced[i + 1]?.time)) return i;
		}
		if (rest) return rest.afterIndex;
		return startedLyricIndex;
	});
	let progress = $derived(track?.length ? Math.min(1, displayPosition / track.length) : 0);
	let instrumentalDots = $derived.by(() => {
		const states = instrumentalDotStatesFromGap(rest, lyricClock);
		if (!rest) return states;
		return states.map((v) => 0.28 + v * 0.72);
	});
	let restFocus = $derived(Boolean(rest) && !rest.blank);
	let artPulse = $derived(track?.playing ? 1 + $bassLevel * 0.045 : 1);
	let carouselCards = $derived.by(() => {
		const list = [];
		if (carousel.prev) list.push({ ...carousel.prev, slot: 'prev' });
		if (carousel.current) list.push({ ...carousel.current, slot: 'current' });
		if (carousel.next) list.push({ ...carousel.next, slot: 'next' });
		if (list.length) return list;
		if (!track) return [];
		return [{ key: trackKey, art: track.art, slot: 'current' }];
	});

	$effect(() => {
		const next = track;
		if (!next) return;
		if (next.art !== lastArtUrl) {
			lastArtUrl = next.art;
			artFailed = false;
		}
		if (next.title) carousel = rememberNowPlaying(next);
	});

	function measureLyricsOffset() {
		const viewport = lyricsViewport;
		if (!viewport) return null;
		const restSlot = rest;
		const focusY = viewport.clientHeight * 0.38;
		if (restSlot && !restSlot.blank) {
			if (restSlot.afterIndex < 0) return focusY + 28;
			const finished = viewport.querySelector(`[data-lyric="${restSlot.afterIndex}"]`);
			if (!finished) return null;
			const padBottom = parseFloat(getComputedStyle(finished).paddingBottom) || 0;
			const textBottom = finished.offsetTop + finished.offsetHeight - padBottom;
			return focusY - textBottom - 22;
		}
		const idx = restSlot?.blank ? restSlot.afterIndex : focusLyricIndex;
		if (idx === -1) return 0;
		const el = viewport.querySelector(`[data-lyric="${idx}"]`);
		if (!el) return null;
		return focusY - el.offsetTop - el.offsetHeight / 2;
	}

	function tick(now) {
		if (isPlaybackJump(lastSample, track)) snapLyrics = true;
		displayPosition = livePlaybackPosition(track, Date.now());
		lastSample = track;
		const key = trackKey;
		if (key !== lastTrackKey) {
			lastTrackKey = key;
			stackReady = false;
		}
		const target = measureLyricsOffset();
		if (target != null) {
			const ts = Number(now) || (typeof performance !== 'undefined' ? performance.now() : 0);
			const dt = lastEaseAt ? Math.min(0.1, Math.max(0, (ts - lastEaseAt) / 1000)) : 0.016;
			lastEaseAt = ts;
			if (!stackReady || snapLyrics || reducedMotion) {
				lyricsOffset = target;
				stackReady = true;
			} else {
				lyricsOffset = easeToward(lyricsOffset, target, dt, STACK_EASE_TAU_SEC);
			}
		}
		raf = requestAnimationFrame(tick);
	}

	onMount(() => {
		if (typeof window !== 'undefined') {
			const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
			reducedMotion = mq.matches;
			const onChange = (e) => {
				reducedMotion = e.matches;
			};
			mq.addEventListener('change', onChange);
			raf = requestAnimationFrame(tick);
			return () => {
				mq.removeEventListener('change', onChange);
				cancelAnimationFrame(raf);
			};
		}
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	$effect(() => {
		if (!snapLyrics) return;
		const id = requestAnimationFrame(() => {
			snapLyrics = false;
		});
		return () => cancelAnimationFrame(id);
	});

	function fmtTime(sec) {
		const n = Number(sec);
		if (!Number.isFinite(n) || n < 0) return '0:00';
		const m = Math.floor(n / 60);
		const s = String(Math.floor(n % 60)).padStart(2, '0');
		return `${m}:${s}`;
	}

	function send(action) {
		fetch('/api/player/' + action, { method: 'POST' })
			.then(nudgeNowPlaying)
			.catch(() => {});
	}

	function togglePlay() {
		const live = livePlaybackPosition(track, Date.now());
		if (track?.playing) {
			applyTransportOptimistic({
				playing: false,
				paused: true,
				position: live,
				positionAt: Date.now(),
				seeking: false
			});
		} else {
			applyTransportOptimistic({
				playing: true,
				paused: false,
				position: live,
				positionAt: Date.now(),
				seeking: false
			});
		}
		send('play-pause');
	}

	function seekTo(sec) {
		const length = Number(track?.length) || 0;
		const position = length > 0 ? Math.min(Math.max(0, sec), length) : Math.max(0, sec);
		applyTransportOptimistic({
			position,
			positionAt: Date.now(),
			seeking: true
		});
		displayPosition = position;
		snapLyrics = true;
		fetch('/api/player/seek', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ position })
		})
			.then(nudgeNowPlaying)
			.catch(() => {});
	}

	function onSeekPointer(e) {
		const length = Number(track?.length) || 0;
		if (length <= 0) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		seekTo(ratio * length);
	}

	function onSeekKey(e) {
		const length = Number(track?.length) || 0;
		if (length <= 0) return;
		const step = Math.max(5, length * 0.05);
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			e.preventDefault();
			seekTo(displayPosition + step);
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			e.preventDefault();
			seekTo(displayPosition - step);
		} else if (e.key === 'Home') {
			e.preventDefault();
			seekTo(0);
		} else if (e.key === 'End') {
			e.preventDefault();
			seekTo(length);
		}
	}

	function wordsSungOn(line, wordIndex, nextStart) {
		if (!line) return false;
		if ((Number(line.time) || 0) > lyricClock) return false;
		if (lineSungThrough(line, lyricClock, nextStart)) return true;
		return wordIndex < activeWordIndex(line.words, lyricClock);
	}

	function wordSung(line, wordIndex) {
		return wordsSungOn(synced?.[line], wordIndex, synced?.[line + 1]?.time);
	}

	function lineIsPast(lineIndex) {
		if (rest?.blank && rest.afterIndex === lineIndex) return false;
		const row = synced?.[lineIndex];
		if (!row?.text) return false;
		return lineSungThrough(row, lyricClock, synced[lineIndex + 1]?.time);
	}

	function lineIsActive(lineIndex) {
		if (rest?.blank && rest.afterIndex === lineIndex) return true;
		return isLineSinging(synced?.[lineIndex], lyricClock, synced?.[lineIndex + 1]?.time);
	}

	function lineIsResting(lineIndex) {
		return restFocus && rest.afterIndex === lineIndex;
	}

	function lineDelta(lineIndex) {
		if (rest) {
			if (rest.blank || rest.afterIndex < 0) return lineIndex - rest.afterIndex;
			return lineIndex <= rest.afterIndex
				? lineIndex - rest.afterIndex - 1
				: lineIndex - rest.afterIndex;
		}
		const origin = focusLyricIndex >= 0 ? focusLyricIndex : startedLyricIndex;
		if (origin < 0) return lineIndex + 1;
		return lineIndex - origin;
	}

	function paintFor(line, nextStart) {
		const words = line?.words;
		if (!words?.length) {
			return { wordIdx: -1, fill: 0, held: false, singing: isLineSinging(line, lyricClock, nextStart) };
		}
		const singing = isLineSinging(line, lyricClock, nextStart);
		const wordIdx = activeWordIndex(words, lyricClock);
		if (!singing || wordIdx < 0) return { wordIdx, fill: 0, held: false, singing };
		return {
			wordIdx,
			singing,
			fill: wordProgress(words, wordIdx, lyricClock, line?.end, nextStart),
			held: isHeldWord(words, wordIdx, line?.end, HELD_WORD_SEC, nextStart)
		};
	}

	function wordChars(text) {
		return Array.from(String(text || ''));
	}

	function heldLetterFill(progress, index, text) {
		return letterFill(progress, index, wordChars(text).length);
	}

	function dotBrightness(lineIndex, dotIndex) {
		if (rest?.blank && rest.afterIndex === lineIndex) return instrumentalDots[dotIndex] ?? 0;
		if (lineIndex < startedLyricIndex) return 1;
		return 0;
	}
</script>

<div class="music-view">
	{#if !track}
		<div class="player-body">
			<div class="skeleton art-skeleton"></div>
			<div class="skeleton title-skeleton"></div>
			<div class="skeleton bar-skeleton"></div>
		</div>
	{:else if !hasTrack}
		<div class="empty">
			<p class="empty-title">Nothing playing</p>
			<p class="empty-copy">AirPlay from Apple Music, connect Bluetooth, or start a track here.</p>
		</div>
	{:else}
		<div class="player-body" class:with-lyrics={Boolean(synced || plainLyrics || lyricsPending)}>
			<div class="player-main">
				<div class="art-slot" class:playing={track.playing} style="--pulse: {artPulse}">
					<div class="art-stage" class:peeks={carouselCards.length > 1}>
						{#each carouselCards as card (card.key)}
							<div
								class="album-card"
								class:current={card.slot === 'current'}
								class:prev={card.slot === 'prev'}
								class:next={card.slot === 'next'}
								class:playing={card.slot === 'current' && track.playing}
								aria-hidden={card.slot !== 'current'}
							>
								{#if card.slot === 'current' && card.art && !artFailed}
									<img class="art-image" src={card.art} alt="" onerror={() => (artFailed = true)} />
								{:else if card.art}
									<img class="art-image" src={card.art} alt="" />
								{:else if card.slot === 'current'}
									<div class="vinyl-groove"></div>
									<div class="center-label"></div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
				<div class="track-info">
					<h1 class="track-title">{track.title}</h1>
					<div class="track-artist">{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
				</div>

				<div class="times">
					<span>{fmtTime(displayPosition)}</span>
					<span>{fmtTime(track.length)}</span>
				</div>
				<div
					class="progress"
					style="--p: {progress}"
					role="slider"
					tabindex="0"
					aria-label="Seek"
					aria-valuemin="0"
					aria-valuemax={track.length || 0}
					aria-valuenow={displayPosition}
					onpointerdown={onSeekPointer}
					onkeydown={onSeekKey}
				>
					<div class="progress-fill"></div>
				</div>

				<div class="controls">
					<button type="button" aria-label="Previous" onclick={() => send('previous')}>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path d="M6 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
							<path d="M18 6 8 12l10 6V6Z" fill="currentColor" />
						</svg>
					</button>
					<button
						type="button"
						class="play"
						aria-label={track.playing ? 'Pause' : 'Play'}
						onclick={togglePlay}
					>
						{#if track.playing}
							<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
								<rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
							</svg>
						{:else}
							<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<path d="M7 5v14l13-7L7 5Z" fill="currentColor" />
							</svg>
						{/if}
					</button>
					<button type="button" aria-label="Next" onclick={() => send('next')}>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path d="M18 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
							<path d="M6 6l10 6L6 18V6Z" fill="currentColor" />
						</svg>
					</button>
				</div>
			</div>

			{#if synced}
				<div class="lyrics-viewport synced" bind:this={lyricsViewport}>
					<div
						class="lyrics-stack"
						class:instant={reducedMotion || snapLyrics}
						style="transform: translate3d(0, {lyricsOffset}px, 0)"
					>
						{#each synced as line, i (`${line.time}:${line.side ?? ''}:${line.text}`)}
							{@const paint = paintFor(line, synced[i + 1]?.time)}
							<p
								class="lyric-line"
								class:active={lineIsActive(i)}
								class:past={lineIsPast(i)}
								class:near={Math.abs(lineDelta(i)) === 1}
								class:resting={lineIsResting(i)}
								class:reply={isLyricReply(line)}
								data-lyric={i}
							>
								<span class="lyric-lead">
									{#if line.words?.length}
										{#each line.words as word, w (w)}
											{#if w > 0 && !shouldGlueLyricTokens(line.words[w - 1].text, word.text)}{' '}{/if}<span
												class="lyric-word"
												class:sung={wordSung(i, w)}
												class:filling={paint.singing && w === paint.wordIdx}
												class:held={paint.singing && w === paint.wordIdx && paint.held && !reducedMotion}
												style={paint.singing && w === paint.wordIdx ? `--wp: ${paint.fill}` : undefined}
											>{#if paint.singing && w === paint.wordIdx && paint.held && !reducedMotion}{#each wordChars(word.text) as ch, ci (ci)}<span class="lyric-letter" style="--fill: {heldLetterFill(paint.fill, ci, word.text)}; --wave: {letterWave(heldLetterFill(paint.fill, ci, word.text))}">{ch}</span>{/each}{:else}{word.text}{/if}</span>
										{/each}
									{:else if line.text}
										{line.text}
									{:else}
										<span class="lyric-dots" aria-hidden="true">
											{#each instrumentalDots as _, d (d)}
												{@const b = dotBrightness(i, d)}
												<span class="dot" style="opacity: {b}; --o: {b}"></span>
											{/each}
										</span>
									{/if}
								</span>
								{#if line.background?.length}
									{#each line.background as bg, b (`${bg.time}:${bg.text}`)}
										{@const bgPaint = paintFor(bg, line.background[b + 1]?.time ?? line.end)}
										<span class="lyric-bg" class:singing={bgPaint.singing}>
											{#if bg.words?.length}
												{#each bg.words as word, w (w)}
													{#if w > 0 && !shouldGlueLyricTokens(bg.words[w - 1].text, word.text)}{' '}{/if}<span
														class="lyric-word"
														class:sung={wordsSungOn(bg, w, line.background[b + 1]?.time ?? line.end)}
														class:filling={bgPaint.singing && w === bgPaint.wordIdx}
														style={bgPaint.singing && w === bgPaint.wordIdx ? `--wp: ${bgPaint.fill}` : undefined}
													>{word.text}</span>
												{/each}
											{:else}
												{bg.text}
											{/if}
										</span>
									{/each}
								{/if}
							</p>
						{/each}
					</div>
					<div
						class="lyric-rest-focus"
						class:open={restFocus}
						class:instant={reducedMotion || snapLyrics}
						aria-hidden="true"
					>
						<span class="lyric-dots">
							{#each instrumentalDots as brightness, d (d)}
								<span
									class="dot"
									class:filling={brightness > 0.08 && brightness < 0.92}
									style="opacity: {brightness}; --o: {brightness}"
								></span>
							{/each}
						</span>
					</div>
				</div>
			{:else if plainLyrics}
				<div class="lyrics-viewport plain">
					{#key plainLyrics}
						<p class="lyric-line plain-block">{plainLyrics}</p>
					{/key}
				</div>
			{:else if lyricsPending}
				<div class="lyrics-viewport pending">
					<div class="loading-dots" class:instant={reducedMotion} aria-hidden="true">
						<span class="dot"></span>
						<span class="dot"></span>
						<span class="dot"></span>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.music-view {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
	}

	.player-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-6);
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.player-body.with-lyrics {
		display: grid;
		grid-template-columns: minmax(16rem, 0.9fr) minmax(0, 1.2fr);
		align-items: stretch;
		justify-content: stretch;
		gap: var(--space-8);
		padding: 0 var(--space-2);
	}
	.player-main {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto auto auto auto;
		grid-template-columns: minmax(0, 1fr);
		justify-items: center;
		align-content: center;
		gap: var(--space-3);
		min-width: 0;
		min-height: 0;
		width: 100%;
		height: 100%;
	}

	.art-slot {
		min-width: 0;
		min-height: 0;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		perspective: 980px;
	}
	.art-stage {
		position: relative;
		width: min(100%, 42vh, 420px);
		aspect-ratio: 1;
		max-height: 100%;
		display: grid;
		place-items: center;
		transform-style: preserve-3d;
	}
	.with-lyrics .art-stage {
		width: min(100%, 28vh, 280px);
	}
	.album-card {
		grid-area: 1 / 1;
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-lg);
		border: 1px solid var(--hairline);
		background: linear-gradient(160deg, var(--abyss-2) 0%, var(--abyss) 62%, color-mix(in srgb, var(--brand) 12%, var(--abyss)) 100%);
		overflow: hidden;
		box-shadow: var(--elevation-2);
		transform-origin: center center;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.album-card.prev,
	.album-card.next {
		z-index: 0;
		filter: brightness(0.38) saturate(0.78);
		pointer-events: none;
	}
	.album-card.prev {
		transform: translateX(-46%) rotateY(28deg) scale(0.78);
	}
	.album-card.next {
		transform: translateX(46%) rotateY(-28deg) scale(0.78);
	}
	.album-card.current {
		z-index: 2;
		box-shadow: var(--elevation-3);
		transform: scale(var(--pulse, 1));
		filter: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.album-card {
			transition:
				transform 620ms var(--spring-smooth),
				filter 480ms var(--spring-smooth),
				box-shadow 480ms var(--spring-smooth);
		}
		.album-card.current.playing {
			animation: art-drift 9s ease-in-out infinite;
		}
	}
	@keyframes art-drift {
		0%, 100% { transform: scale(var(--pulse, 1)) translate3d(0, 0, 0) rotate(0deg); }
		50% { transform: scale(var(--pulse, 1)) translate3d(0, -4px, 0) rotate(0.6deg); }
	}
	.art-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
		display: block;
	}
	.vinyl-groove {
		position: absolute;
		inset: clamp(24px, 4vh, 48px);
		border-radius: 50%;
		border: 2px solid var(--hairline);
		box-shadow: inset 0 0 50px color-mix(in srgb, var(--background) 70%, transparent);
	}
	.vinyl-groove::before,
	.vinyl-groove::after {
		content: '';
		position: absolute;
		border-radius: 50%;
		border: 1px solid var(--hairline);
	}
	.vinyl-groove::before { inset: clamp(20px, 3vh, 36px); }
	.vinyl-groove::after { inset: clamp(48px, 7vh, 80px); }
	.center-label {
		width: clamp(56px, 8vh, 90px);
		height: clamp(56px, 8vh, 90px);
		border-radius: 50%;
		background: var(--abyss-2);
		border: 2px solid var(--hairline);
		z-index: 2;
	}

	.track-info { text-align: center; min-width: 0; max-width: 100%; }
	.track-title {
		margin: 0;
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw, 2.75rem);
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.03em;
		overflow-wrap: anywhere;
	}
	.with-lyrics .track-title {
		font-size: clamp(1.25rem, 2.1vw, 2rem);
	}
	.track-artist {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		color: var(--text-secondary);
		margin-top: var(--space-2);
		overflow-wrap: anywhere;
	}

	.times {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		width: min(540px, 100%);
		max-width: 100%;
		flex-shrink: 0;
		font-family: var(--font-code);
		font-size: var(--text-lg);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--text-tertiary);
	}
	.with-lyrics .times,
	.with-lyrics .progress {
		width: min(100%, 28rem);
	}
	.progress {
		width: min(540px, 100%);
		max-width: 100%;
		flex-shrink: 0;
		height: 14px;
		display: flex;
		align-items: center;
		cursor: pointer;
		background: linear-gradient(var(--hairline), var(--hairline)) center / 100% 2px no-repeat;
		border-radius: 0;
	}
	.progress-fill {
		width: 100%;
		height: 2px;
		background: var(--accent);
		border-radius: 0;
		transform: scaleX(var(--p, 0));
		transform-origin: left center;
		pointer-events: none;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-shrink: 0;
	}
	.controls button {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		width: 3.25rem;
		height: 3.25rem;
		padding: 0;
		border-radius: 999px;
		transition:
			color 220ms var(--spring-smooth),
			transform 220ms var(--spring-smooth),
			background 220ms var(--spring-smooth);
	}
	.controls button svg {
		width: 1.5rem;
		height: 1.5rem;
		display: block;
	}
	.controls button:hover { color: var(--accent); background: var(--shell-fill); }
	.controls button:active { transform: scale(0.94); }
	.controls button.play {
		width: 4.25rem;
		height: 4.25rem;
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
		color: var(--accent-strong);
	}
	.controls button.play svg { width: 1.9rem; height: 1.9rem; }
	.controls button.play:hover { background: var(--accent); color: var(--abyss); }

	.lyrics-viewport {
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
		position: relative;
		mask-image: none;
	}
	.lyrics-viewport.synced,
	.lyrics-viewport.plain {
		mask-image: linear-gradient(to bottom, transparent, var(--foreground) 16%, var(--foreground) 84%, transparent);
		-webkit-mask-image: linear-gradient(to bottom, transparent, var(--foreground) 16%, var(--foreground) 84%, transparent);
	}
	.lyrics-stack {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-5);
		padding: 0 var(--space-4);
		will-change: transform;
		/* Vertical travel is lerped in rAF (`easeToward`) so line changes and
		   instrumental rests glide instead of waiting on a CSS custom-prop. */
	}
	.lyric-line {
		margin: 0;
		font-family: var(--font-body);
		font-size: clamp(1.15rem, 2.2vw, 1.85rem);
		font-weight: 600;
		font-style: normal;
		line-height: 1.35;
		color: var(--text-tertiary);
		opacity: 1;
		transform-origin: left center;
		transform: translate3d(0, 14px, 0) scale(0.96);
		transition:
			color 560ms var(--spring-smooth),
			opacity 640ms var(--spring-smooth),
			transform 720ms var(--ease-out),
			filter 560ms var(--spring-smooth),
			padding-bottom 720ms var(--ease-out);
	}
	.lyric-lead {
		display: block;
		opacity: 0.42;
		filter: blur(0.35px);
		transition:
			color 560ms var(--spring-smooth),
			opacity 640ms var(--spring-smooth),
			filter 560ms var(--spring-smooth);
	}
	.lyric-line.near {
		transform: translate3d(-2px, 8px, 0) scale(0.985);
	}
	.lyric-line.near .lyric-lead {
		opacity: 0.62;
		filter: none;
	}
	.lyric-line.past {
		transform: translate3d(0, -14px, 0) scale(0.94);
	}
	.lyric-line.past .lyric-lead {
		opacity: 0.28;
		filter: blur(0.45px);
	}
	.lyric-line.resting {
		padding-bottom: 2.6em;
	}
	.lyric-line.active {
		color: var(--foreground);
		transform: translate3d(0, 0, 0) scale(1.03);
	}
	.lyric-line.active .lyric-lead {
		opacity: 1;
		filter: none;
		color: var(--foreground);
	}
	.lyric-line.reply {
		align-self: flex-start;
		max-width: 72%;
		margin-left: 22%;
		text-align: left;
		font-size: clamp(0.92rem, 1.7vw, 1.38rem);
		font-weight: 500;
		transform-origin: left center;
	}
	.lyric-line.reply.near {
		transform: translate3d(-2px, 8px, 0) scale(0.985);
	}
	.lyric-line.reply.active {
		transform: translate3d(0, 0, 0) scale(1.02);
	}
	.lyric-line.reply.past {
		transform: translate3d(0, -14px, 0) scale(0.94);
	}
	.lyric-bg {
		display: block;
		margin-top: 0.32em;
		font-size: 0.72em;
		font-weight: 650;
		letter-spacing: 0.01em;
		line-height: 1.35;
		color: color-mix(in srgb, var(--foreground) 90%, transparent);
		opacity: 0.9;
		filter: none;
	}
	.lyric-line.near .lyric-bg {
		opacity: 0.94;
	}
	.lyric-line.past .lyric-bg {
		opacity: 0.78;
		color: color-mix(in srgb, var(--foreground) 84%, transparent);
	}
	.lyric-line.active .lyric-bg,
	.lyric-line .lyric-bg.singing,
	.lyric-line.past .lyric-bg.singing {
		opacity: 1;
		color: color-mix(in srgb, var(--foreground) 96%, transparent);
	}
	.lyric-bg .lyric-word {
		opacity: 0.9;
	}
	.lyric-line.active .lyric-bg .lyric-word.sung,
	.lyric-bg .lyric-word.sung,
	.lyric-bg .lyric-word.filling {
		opacity: 1;
	}
	.lyric-line.past .lyric-bg .lyric-word {
		opacity: 1;
	}
	.lyric-bg .lyric-word.filling:not(.held) {
		background-image: linear-gradient(
			to right,
			var(--foreground) 0%,
			var(--foreground) calc(var(--wp, 0) * 100%),
			color-mix(in srgb, var(--foreground) 78%, transparent) calc(var(--wp, 0) * 100%),
			color-mix(in srgb, var(--foreground) 78%, transparent) 100%
		);
	}
	.lyrics-stack.instant .lyric-line {
		transition: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.lyric-line,
		.lyric-line.near,
		.lyric-line.past,
		.lyric-line.active,
		.lyric-line.reply,
		.lyric-line.reply.near,
		.lyric-line.reply.active,
		.lyric-line.reply.past,
		.lyric-lead,
		.lyric-line.past .lyric-lead {
			transform: none;
			filter: none;
		}
	}
	.lyric-rest-focus {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		top: 38%;
		z-index: 2;
		opacity: 0;
		pointer-events: none;
		transform: translateY(-42%);
		transform-origin: left center;
		font-family: var(--font-body);
		font-size: clamp(1.15rem, 2.2vw, 1.85rem);
		font-weight: 600;
		color: var(--foreground);
		transition: opacity 280ms var(--spring-smooth);
	}
	@media (prefers-reduced-motion: no-preference) {
		.lyric-rest-focus {
			transition:
				opacity 720ms var(--spring-smooth),
				transform 720ms var(--ease-out);
		}
	}
	.lyric-rest-focus.open {
		opacity: 1;
		transform: translateY(-50%);
	}
	.lyric-rest-focus .lyric-dots {
		gap: 0.18em;
	}
	.lyric-rest-focus .dot {
		width: 0.28em;
		height: 0.28em;
		transform-origin: left center;
		transform: translateY(calc((1 - var(--o, 0)) * 0.1em)) scale(calc(0.82 + 0.18 * var(--o, 0)));
		filter: drop-shadow(0 0 calc(3px + 8px * var(--o, 0)) color-mix(in srgb, var(--foreground) calc(22% + var(--o, 0) * 38%), transparent));
	}
	@media (prefers-reduced-motion: no-preference) {
		.lyric-rest-focus .dot.filling {
			animation: rest-dot-lift 1.05s var(--spring-smooth) infinite;
		}
	}
	@keyframes rest-dot-lift {
		0%,
		100% {
			transform: translateY(calc((1 - var(--o, 0)) * 0.1em)) scale(calc(0.82 + 0.18 * var(--o, 0)));
		}
		50% {
			transform: translateY(calc((1 - var(--o, 0)) * 0.1em - 0.1em))
				scale(calc(0.9 + 0.14 * var(--o, 0)));
		}
	}
	.lyric-rest-focus.instant {
		transition: none;
	}
	.lyric-rest-focus.instant .dot.filling {
		animation: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.lyric-rest-focus,
		.lyric-rest-focus.open {
			transform: translateY(-50%);
		}
	}
	.lyric-word {
		display: inline;
		opacity: 0.42;
		transition: opacity 50ms linear;
	}
	.lyric-line.active .lyric-word.sung,
	.lyric-line.past .lyric-word {
		opacity: 1;
	}
	/* The word currently being sung fills left-to-right in real time - a
	   sub-letter-resolution sweep via a hard-stop gradient clipped to the
	   text, rather than the binary sung/unsung flip the other words get. */
	.lyric-word.filling:not(.held) {
		opacity: 1;
		color: transparent;
		background-image: linear-gradient(
			to right,
			var(--foreground) 0%,
			var(--foreground) calc(var(--wp, 0) * 100%),
			color-mix(in srgb, var(--foreground) 42%, transparent) calc(var(--wp, 0) * 100%),
			color-mix(in srgb, var(--foreground) 42%, transparent) 100%
		);
		background-clip: text;
		-webkit-background-clip: text;
		transition: none;
	}
	.lyric-word.held {
		opacity: 1;
		color: inherit;
	}
	.lyric-letter {
		display: inline-block;
		transform: translateY(calc(var(--wave, 0) * -0.22em)) scale(calc(1 + var(--wave, 0) * 0.06));
		color: color-mix(
			in srgb,
			var(--foreground) calc(var(--fill, 0) * 100%),
			color-mix(in srgb, var(--foreground) 40%, transparent)
		);
		text-shadow: 0 0 calc(var(--wave, 0) * 22px) color-mix(in srgb, var(--foreground) calc(var(--wave, 0) * 70%), transparent);
		filter: brightness(calc(1 + var(--wave, 0) * 0.45));
		will-change: transform, filter, text-shadow;
	}
	@media (prefers-reduced-motion: reduce) {
		.lyric-letter {
			transform: none;
			text-shadow: none;
			filter: none;
		}
	}
	.lyric-dots {
		display: inline-flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.18em;
	}
	/* Each dot's opacity is driven inline from instrumentalDotStates - they
	   light up one at a time as the actual instrumental gap elapses, not on
	   a fixed timer, so a long break sweeps slowly and a short one sweeps
	   fast. The transition just smooths the per-frame opacity updates. */
	.dot {
		width: 0.28em;
		height: 0.28em;
		border-radius: 50%;
		background: currentColor;
		transform-origin: left center;
		transform: scale(calc(0.82 + 0.18 * var(--o, 0)));
	}
	@media (prefers-reduced-motion: no-preference) {
		.dot {
			transition:
				opacity 280ms var(--spring-smooth),
				transform 280ms var(--spring-smooth);
		}
	}
	.lyrics-viewport.pending {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* Same dot as the in-lyrics instrumental-gap indicator above, so the
	   "something's happening, hold on" language reads the same whether it's
	   a musical break or the lyrics lookup itself still in flight - just
	   self-animating on a loop instead of driven by playback position. */
	.loading-dots {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		color: var(--text-tertiary);
	}
	.loading-dots .dot {
		opacity: 0.3;
	}
	@media (prefers-reduced-motion: no-preference) {
		.loading-dots:not(.instant) .dot {
			animation: loading-dot-pulse 1.1s ease-in-out infinite;
		}
		.loading-dots:not(.instant) .dot:nth-child(2) {
			animation-delay: 0.15s;
		}
		.loading-dots:not(.instant) .dot:nth-child(3) {
			animation-delay: 0.3s;
		}
	}
	.loading-dots.instant .dot {
		opacity: 0.55;
	}
	@keyframes loading-dot-pulse {
		0%,
		80%,
		100% {
			opacity: 0.3;
			transform: scale(0.8);
		}
		40% {
			opacity: 1;
			transform: scale(1);
		}
	}
	.lyric-line.plain-block {
		font-size: var(--text-lg);
		font-weight: 400;
		color: var(--text-secondary);
		opacity: 1;
		white-space: pre-line;
		line-height: 1.6;
		padding: var(--space-4);
		overflow-y: auto;
		height: 100%;
	}
	@media (prefers-reduced-motion: no-preference) {
		.lyric-line.plain-block {
			animation: plain-lyrics-in 320ms var(--spring-smooth);
		}
	}
	@keyframes plain-lyrics-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-end;
		gap: var(--space-2);
		padding-bottom: var(--space-4);
		color: var(--text-tertiary);
		font-family: var(--font-body);
		font-size: var(--text-xl);
		text-align: left;
		max-width: var(--measure);
	}
	.empty-title {
		margin: 0;
		font-size: clamp(1.75rem, 3vw, 2.75rem);
		color: var(--foreground);
		font-weight: 600;
		font-style: normal;
		letter-spacing: -0.04em;
	}
	.empty-copy {
		margin: 0;
		color: var(--text-secondary);
		line-height: 1.45;
		text-wrap: pretty;
	}

	.art-skeleton { width: min(42vh, 420px); height: min(42vh, 420px); border-radius: var(--radius-lg); }
	.title-skeleton { width: 340px; height: 44px; }
	.bar-skeleton { width: min(540px, 70vw); height: 2px; border-radius: 0; }

	@media (prefers-reduced-motion: no-preference) {
		.album-card.current.playing .vinyl-groove {
			animation: spin 8s linear infinite;
		}
	}
	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	@media (max-width: 768px) {
		.player-body.with-lyrics {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(12rem, 1fr);
			overflow: hidden;
		}
		.with-lyrics .times,
		.with-lyrics .progress {
			width: min(540px, 100%);
		}
		.lyrics-viewport {
			min-height: 12rem;
		}
	}
</style>
