<script>
	import { onMount } from 'svelte';
	import { nowPlaying } from '$lib/stores.js';

	let artFailed = $state(false);
	let lastArtUrl = null;
	let displayPosition = $state(0);
	let lastSyncTime = 0;
	let lastSyncPosition = 0;
	let raf = 0;

	let track = $derived($nowPlaying);
	let hasTrack = $derived(Boolean(track?.title || track?.playing));

	$effect(() => {
		const next = track;
		if (!next) return;
		if (next.art !== lastArtUrl) {
			lastArtUrl = next.art;
			artFailed = false;
		}
		const pos = Number(next.position) || 0;
		displayPosition = pos;
		lastSyncPosition = pos;
		lastSyncTime = Date.now();
	});

	function tick() {
		if (track?.playing) {
			const elapsed = (Date.now() - lastSyncTime) / 1000;
			const next = lastSyncPosition + elapsed;
			displayPosition = track.length ? Math.min(next, track.length) : next;
		}
		raf = requestAnimationFrame(tick);
	}

	onMount(() => {
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	function fmtTime(sec) {
		if (!sec || isNaN(sec)) return '0:00';
		const m = Math.floor(sec / 60);
		const s = String(Math.floor(sec % 60)).padStart(2, '0');
		return `${m}:${s}`;
	}

	function send(action) {
		fetch('/api/player/' + action, { method: 'POST' }).catch(() => {});
	}

	let synced = $derived((track?.lyrics?.length ?? 0) > 1 ? track.lyrics : null);
	let plainLyrics = $derived(
		!synced && track?.lyrics?.length === 1 ? track.lyrics[0].text : null
	);
	let activeLyricIndex = $derived.by(() => {
		if (!synced) return -1;
		let idx = -1;
		for (let i = 0; i < synced.length; i++) {
			if (synced[i].time <= displayPosition) idx = i;
			else break;
		}
		return idx;
	});

	let lyricsEl = $state(null);
	$effect(() => {
		const idx = activeLyricIndex;
		if (idx < 0 || !lyricsEl) return;
		lyricsEl.children[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	});
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
				<div class="album-art" class:playing={track.playing}>
					{#if track.art && !artFailed}
						<img
							class="art-image"
							src={track.art}
							alt=""
							onerror={() => (artFailed = true)}
						/>
					{:else}
						<div class="vinyl-groove"></div>
						<div class="center-label"></div>
					{/if}
				</div>
				<div class="track-info">
					<div class="track-title">{track.title}</div>
					<div class="track-artist">{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
				</div>

				<div class="times">
					<span>{fmtTime(displayPosition)}</span>
					<span>{fmtTime(track.length)}</span>
				</div>
				<div class="progress" style="--p: {track.length ? displayPosition / track.length : 0}">
					<div class="progress-fill"></div>
				</div>

				<div class="controls">
					<button type="button" onclick={() => send('previous')}>prev</button>
					<button type="button" class="play" onclick={() => send('play-pause')}>{track.playing ? 'pause' : 'play'}</button>
					<button type="button" onclick={() => send('next')}>next</button>
				</div>
			</div>

			{#if synced}
				<div class="lyrics-panel synced" bind:this={lyricsEl}>
					{#each synced as line, i (i)}
						<p class="lyric-line" class:active={i === activeLyricIndex} class:past={i < activeLyricIndex}>
							{line.text || '♪'}
						</p>
					{/each}
				</div>
			{:else if plainLyrics}
				<div class="lyrics-panel">
					<p class="lyric-line plain-block">{plainLyrics}</p>
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
		grid-template-columns: minmax(18rem, 0.92fr) minmax(0, 1.15fr);
		align-items: stretch;
		justify-content: stretch;
		gap: var(--space-8);
		padding: 0 var(--space-2);
	}
	.player-main {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		min-width: 0;
		min-height: 0;
		max-height: 100%;
	}

	.album-art {
		width: min(42vh, 420px);
		height: min(42vh, 420px);
		flex-shrink: 0;
		aspect-ratio: 1;
		border-radius: var(--radius-lg);
		background: linear-gradient(160deg, var(--abyss-2) 0%, var(--abyss) 62%, color-mix(in srgb, var(--brand) 12%, var(--abyss)) 100%);
		border: 1px solid var(--hairline);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
		box-shadow: var(--elevation-3);
	}
	.art-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
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
		width: min(540px, 100%);
		font-family: var(--font-code);
		font-size: var(--text-lg);
		color: var(--text-tertiary);
	}
	.with-lyrics .album-art {
		width: min(26vh, 280px);
		height: min(26vh, 280px);
	}
	.with-lyrics .track-title {
		font-size: clamp(1.25rem, 2.1vw, 2rem);
	}
	.with-lyrics .times,
	.with-lyrics .progress {
		width: min(100%, 22rem);
	}
	.progress {
		width: min(540px, 100%);
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
		background: none;
		border: none;
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-lg);
		letter-spacing: 0.04em;
		cursor: pointer;
		padding: var(--space-3) var(--space-4);
		transition:
			color 220ms var(--spring-smooth),
			transform 220ms var(--spring-smooth),
			background 220ms var(--spring-smooth);
	}
	.controls button:hover { color: var(--accent); }
	.controls button:active { transform: scale(0.98); }
	.controls button.play {
		min-width: 5.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
		color: var(--accent-strong);
		font-size: var(--text-lg);
	}
	.controls button.play:hover { background: var(--accent); color: var(--abyss); }

	.lyrics-panel {
		flex: 1;
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
	}
	.lyrics-panel::-webkit-scrollbar {
		display: none;
	}
	.lyrics-panel.synced {
		padding: 18vh var(--space-4);
		mask-image: linear-gradient(to bottom, transparent, var(--foreground) 18%, var(--foreground) 82%, transparent);
		-webkit-mask-image: linear-gradient(to bottom, transparent, var(--foreground) 18%, var(--foreground) 82%, transparent);
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
			opacity 320ms var(--spring-smooth),
			transform 320ms var(--spring-smooth);
	}
	.lyric-line.past {
		opacity: 0.25;
	}
	.lyric-line.active {
		color: var(--foreground);
		opacity: 1;
		transform: scale(1.04);
	}
	.lyric-line.plain-block {
		font-size: var(--text-lg);
		font-weight: 400;
		color: var(--text-secondary);
		opacity: 1;
		white-space: pre-line;
		line-height: 1.6;
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
		.progress-fill {
			transition: transform 400ms var(--spring-smooth);
		}
	}
	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	@media (max-width: 768px) {
		.player-body.with-lyrics {
			grid-template-columns: 1fr;
			overflow: auto;
		}
		.with-lyrics .times,
		.with-lyrics .progress {
			width: min(540px, 90%);
		}
		.lyrics-panel {
			max-height: 28vh;
		}
		.lyrics-panel.synced {
			padding: var(--space-4);
			mask-image: linear-gradient(to bottom, transparent, var(--foreground) 12%, var(--foreground) 88%, transparent);
			-webkit-mask-image: linear-gradient(to bottom, transparent, var(--foreground) 12%, var(--foreground) 88%, transparent);
		}
	}
</style>
