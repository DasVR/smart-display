<script>
	import { onMount } from 'svelte';
	import { nowPlaying } from '$lib/stores.js';
	import { bassLevel } from '$lib/services/audioReactive.js';
	import {
		activeLyricIndex as indexForTime,
		activeWordIndex,
		instrumentalDotStates,
		livePlaybackPosition,
		lyricsAreSynced,
		wordProgress
	} from '$lib/playbackClock.js';
	import { nudgeNowPlaying } from '$lib/services/nowPlayingSync.js';

	let artFailed = $state(false);
	let lastArtUrl = null;
	let displayPosition = $state(0);
	let lyricsOffset = $state(0);
	let raf = 0;
	let lyricsViewport = $state(null);
	let reducedMotion = $state(false);

	let track = $derived($nowPlaying);
	let hasTrack = $derived(Boolean(track?.title || track?.playing));
	let synced = $derived(lyricsAreSynced(track?.lyrics) ? track.lyrics : null);
	let plainLyrics = $derived(!synced && track?.lyrics?.[0]?.text ? track.lyrics[0].text : null);
	let activeLyricIndex = $derived(indexForTime(synced, displayPosition));
	let progress = $derived(track?.length ? Math.min(1, displayPosition / track.length) : 0);
	let activeWordIdx = $derived(activeWordIndex(synced?.[activeLyricIndex]?.words, displayPosition));
	// Fraction (0..1) the way through the currently-singing word, for a
	// smooth left-to-right sweep within the word rather than an instant
	// per-word snap - the "letter by letter" look Apple Music has.
	let activeWordFill = $derived.by(() => {
		const words = synced?.[activeLyricIndex]?.words;
		if (!words?.length || activeWordIdx < 0) return 0;
		return wordProgress(words, activeWordIdx, displayPosition, synced?.[activeLyricIndex + 1]?.time);
	});
	// Per-dot brightness (Apple Music-style: dots light up in sequence as the
	// gap elapses, scaled to how long the actual instrumental section is).
	let instrumentalDots = $derived(instrumentalDotStates(synced, activeLyricIndex, displayPosition));
	// A small, bass-driven breathing scale for the album art - subtle enough
	// not to distract from the art itself, but enough that the cover reads
	// as alive rather than a static image while something is playing.
	let artPulse = $derived(track?.playing ? 1 + $bassLevel * 0.045 : 1);

	$effect(() => {
		const next = track;
		if (!next) return;
		if (next.art !== lastArtUrl) {
			lastArtUrl = next.art;
			artFailed = false;
		}
	});

	function tick() {
		displayPosition = livePlaybackPosition(track, Date.now());
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
		const idx = activeLyricIndex;
		const viewport = lyricsViewport;
		if (!viewport || idx < 0) {
			lyricsOffset = 0;
			return;
		}
		const el = viewport.querySelector(`[data-lyric="${idx}"]`);
		if (!el) return;
		lyricsOffset = viewport.clientHeight * 0.38 - el.offsetTop - el.offsetHeight / 2;
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

	function wordSung(line, wordIndex) {
		if (line < activeLyricIndex) return true;
		if (line !== activeLyricIndex) return false;
		return wordIndex < activeWordIdx;
	}

	function dotBrightness(lineIndex, dotIndex) {
		if (lineIndex < activeLyricIndex) return 1;
		if (lineIndex > activeLyricIndex) return 0;
		return instrumentalDots[dotIndex] ?? 0;
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
		<div class="player-body" class:with-lyrics={Boolean(synced || plainLyrics)}>
			<div class="player-main">
				<div class="art-slot" class:playing={track.playing} style="--pulse: {artPulse}">
					<!-- A purely decorative "more where this came from" stack behind
					     the current album - the audio backends here (playerctl/
					     AirPlay) don't expose an actual upcoming-track queue, so
					     this doesn't claim to show real next-up art, just depth. -->
					<div class="album-stack" aria-hidden="true">
						<div class="stack-card stack-2"></div>
						<div class="stack-card stack-1"></div>
					</div>
					<div class="album-art" class:playing={track.playing}>
						{#if track.art && !artFailed}
							{#key track.art}
								<img
									class="art-image"
									src={track.art}
									alt=""
									onerror={() => (artFailed = true)}
								/>
							{/key}
						{:else}
							<div class="vinyl-groove"></div>
							<div class="center-label"></div>
						{/if}
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
				<div class="progress" style="--p: {progress}">
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
						onclick={() => send('play-pause')}
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
						class:instant={reducedMotion}
						style="transform: translate3d(0, {lyricsOffset}px, 0)"
					>
						{#each synced as line, i (`${line.time}:${line.text}`)}
							<p
								class="lyric-line"
								class:active={i === activeLyricIndex}
								class:past={i < activeLyricIndex}
								data-lyric={i}
							>
								{#if line.words?.length}
									{#each line.words as word, w (w)}
										{#if w > 0}{' '}{/if}<span
											class="lyric-word"
											class:sung={wordSung(i, w)}
											class:filling={i === activeLyricIndex && w === activeWordIdx}
											style={i === activeLyricIndex && w === activeWordIdx
												? `--wp: ${activeWordFill}`
												: undefined}
										>{word.text}</span>
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
							</p>
						{/each}
					</div>
				</div>
			{:else if plainLyrics}
				<div class="lyrics-viewport plain">
					{#key plainLyrics}
						<p class="lyric-line plain-block">{plainLyrics}</p>
					{/key}
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
	}
	@media (prefers-reduced-motion: no-preference) {
		/* A slow, subtle sway on top of the bass pulse so the cover reads as
		   alive during quiet passages too, not just on beats. */
		.art-slot.playing {
			animation: art-drift 9s ease-in-out infinite;
		}
	}
	@keyframes art-drift {
		0%, 100% { transform: translate3d(0, 0, 0) rotate(0deg); }
		50% { transform: translate3d(0, -4px, 0) rotate(0.6deg); }
	}
	.album-stack {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}
	.stack-card {
		position: absolute;
		left: 50%;
		top: 50%;
		width: min(88%, 37vh, 380px);
		aspect-ratio: 1;
		border-radius: var(--radius-lg);
		border: 1px solid var(--hairline);
		background: linear-gradient(160deg, var(--abyss-3) 0%, var(--abyss-1) 100%);
		box-shadow: var(--elevation-2);
	}
	.stack-card.stack-1 {
		transform: translate(-50%, -50%) translate(16px, 20px) rotate(5deg) scale(calc(0.94 * var(--pulse, 1)));
		opacity: 0.75;
	}
	.stack-card.stack-2 {
		transform: translate(-50%, -50%) translate(30px, 38px) rotate(9deg) scale(calc(0.88 * var(--pulse, 1)));
		opacity: 0.45;
	}
	@media (prefers-reduced-motion: no-preference) {
		.stack-card {
			transition: transform 160ms var(--spring-smooth);
		}
	}
	.album-art {
		width: auto;
		height: auto;
		max-width: min(100%, 42vh, 420px);
		max-height: 100%;
		aspect-ratio: 1;
		align-self: center;
		border-radius: var(--radius-lg);
		background: linear-gradient(160deg, var(--abyss-2) 0%, var(--abyss) 62%, color-mix(in srgb, var(--brand) 12%, var(--abyss)) 100%);
		border: 1px solid var(--hairline);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		z-index: 1;
		overflow: hidden;
		box-shadow: var(--elevation-3);
		transform: scale(var(--pulse, 1));
	}
	@media (prefers-reduced-motion: no-preference) {
		.album-art {
			transition: transform 160ms var(--spring-smooth);
		}
	}
	.art-image {
		width: 100%;
		height: 100%;
		object-fit: contain;
		object-position: center;
	}
	@media (prefers-reduced-motion: no-preference) {
		.art-image {
			animation: art-in 420ms var(--spring-smooth);
		}
	}
	@keyframes art-in {
		from {
			opacity: 0;
			transform: scale(0.97);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
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
	.with-lyrics .album-art {
		max-width: min(100%, 28vh, 280px);
	}
	.with-lyrics .stack-card {
		width: min(88%, 24vh, 250px);
	}
	.with-lyrics .track-title {
		font-size: clamp(1.25rem, 2.1vw, 2rem);
	}
	.with-lyrics .times,
	.with-lyrics .progress {
		width: min(100%, 28rem);
	}
	.progress {
		width: min(540px, 100%);
		max-width: 100%;
		flex-shrink: 0;
		height: 2px;
		background: var(--hairline);
		border-radius: 0;
		overflow: hidden;
	}
	.progress-fill {
		width: 100%;
		height: 100%;
		background: var(--accent);
		border-radius: 0;
		transform: scaleX(var(--p, 0));
		transform-origin: left center;
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
		gap: var(--space-4);
		padding: 0 var(--space-4);
		will-change: transform;
		transition: transform 420ms var(--spring-smooth);
	}
	.lyrics-stack.instant {
		transition: none;
	}
	.lyric-line {
		margin: 0;
		font-family: var(--font-body);
		font-size: clamp(1.15rem, 2.2vw, 1.85rem);
		font-weight: 600;
		font-style: normal;
		line-height: 1.35;
		color: var(--text-tertiary);
		opacity: 0.4;
		transform-origin: left center;
		transition:
			color 320ms var(--spring-smooth),
			opacity 320ms var(--spring-smooth);
	}
	.lyric-line.past {
		opacity: 0.25;
	}
	.lyric-line.active {
		color: var(--foreground);
		opacity: 1;
	}
	.lyric-word {
		display: inline;
		opacity: 0.42;
		transition: opacity 90ms linear;
	}
	.lyric-line.active .lyric-word.sung,
	.lyric-line.past .lyric-word {
		opacity: 1;
	}
	/* The word currently being sung fills left-to-right in real time - a
	   sub-letter-resolution sweep via a hard-stop gradient clipped to the
	   text, rather than the binary sung/unsung flip the other words get. */
	.lyric-word.filling {
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
	.lyric-dots {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
	}
	/* Each dot's opacity is driven inline from instrumentalDotStates - they
	   light up one at a time as the actual instrumental gap elapses, not on
	   a fixed timer, so a long break sweeps slowly and a short one sweeps
	   fast. The transition just smooths the per-frame opacity updates. */
	.dot {
		width: 0.4em;
		height: 0.4em;
		border-radius: 50%;
		background: currentColor;
		transform: scale(calc(0.75 + 0.25 * var(--o, 0)));
	}
	@media (prefers-reduced-motion: no-preference) {
		.dot {
			transition:
				opacity 280ms linear,
				transform 280ms var(--spring-smooth);
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
		.album-art.playing .vinyl-groove {
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
