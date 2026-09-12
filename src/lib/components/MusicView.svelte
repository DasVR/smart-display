<script>
	import { onMount } from 'svelte';
	let loading = $state(true);
	let track = $state(null);
	let error = $state(null);
	let artFailed = $state(false);
	let lastArtUrl = null;

	// Smoothly interpolated playback position so the progress bar and the
	// lyrics highlight move continuously between the 3s polls, instead of
	// jumping every time fetchNowPlaying() resolves.
	let displayPosition = $state(0);
	let lastFetchTime = 0;
	let raf = 0;

	function tick() {
		if (track?.playing && track.length) {
			const elapsed = (Date.now() - lastFetchTime) / 1000;
			displayPosition = Math.min(track.position + elapsed, track.length);
		}
		raf = requestAnimationFrame(tick);
	}

	onMount(() => {
		fetchNowPlaying();
		const t = setInterval(fetchNowPlaying, 3000);
		raf = requestAnimationFrame(tick);
		return () => {
			clearInterval(t);
			cancelAnimationFrame(raf);
		};
	});

	async function fetchNowPlaying() {
		try {
			const r = await fetch('/api/nowplaying');
			if (!r.ok) throw new Error('player failed');
			track = await r.json();
			lastFetchTime = Date.now();
			displayPosition = track.position || 0;
			if (track.art !== lastArtUrl) {
				lastArtUrl = track.art;
				artFailed = false;
			}
			error = null;
		} catch (e) {
			error = 'no active media player';
			track = null;
		} finally {
			loading = false;
		}
	}

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
	<div class="header">
		<div class="sub">{track?.playing ? 'Now playing' : 'Idle'}</div>
	</div>

	{#if loading}
		<div class="player-body">
			<div class="skeleton art-skeleton"></div>
			<div class="skeleton title-skeleton"></div>
			<div class="skeleton bar-skeleton"></div>
		</div>
	{:else if error || !track || !track.playing}
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
		display: flex;
		flex-direction: column;
		padding: var(--space-2) 0 var(--space-4);
		gap: var(--space-8);
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
	}

	.header {
		display: flex;
		justify-content: flex-end;
		align-items: flex-end;
		gap: var(--space-4);
		border-bottom: 1px solid var(--hairline);
		padding-bottom: var(--space-6);
		min-width: 0;
	}
	.sub {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.player-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-8);
		min-width: 0;
		min-height: 0;
	}
	.player-body.with-lyrics {
		flex-direction: row;
		align-items: center;
		justify-content: center;
		gap: var(--space-8);
		overflow: hidden;
	}
	.player-main {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		flex-shrink: 0;
		min-width: 0;
		min-height: 0;
		max-height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
	}
	.player-main::-webkit-scrollbar {
		display: none;
	}

	.album-art {
		width: clamp(260px, 36vh, 460px);
		height: clamp(260px, 36vh, 460px);
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

	.track-info { text-align: center; min-width: 0; }
	.track-title {
		font-family: var(--font-body);
		font-size: clamp(1.75rem, 3.4vw, 3.5rem);
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.03em;
		overflow-wrap: anywhere;
	}
	.track-artist {
		font-family: var(--font-body);
		font-size: var(--text-xl);
		color: var(--text-secondary);
		margin-top: var(--space-2);
	}

	.times {
		display: flex;
		justify-content: space-between;
		width: min(540px, 70vw);
		font-family: var(--font-code);
		font-size: var(--text-lg);
		color: var(--text-tertiary);
	}
	.with-lyrics .album-art {
		width: clamp(160px, 22vh, 300px);
		height: clamp(160px, 22vh, 300px);
	}
	.with-lyrics .track-title {
		font-size: clamp(1.5rem, 2.4vw, 2.25rem);
	}
	.with-lyrics .times,
	.with-lyrics .progress {
		width: min(420px, 34vw);
	}
	.progress {
		width: min(540px, 70vw);
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
		gap: var(--space-8);
	}
	.controls button {
		background: none;
		border: none;
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-lg);
		letter-spacing: 0.04em;
		cursor: pointer;
		padding: var(--space-4);
		transition:
			color 220ms var(--spring-smooth),
			transform 220ms var(--spring-smooth),
			background 220ms var(--spring-smooth);
	}
	.controls button:hover { color: var(--accent); }
	.controls button:active { transform: scale(0.98); }
	.controls button.play {
		width: clamp(80px, 10vh, 120px);
		height: clamp(80px, 10vh, 120px);
		border-radius: 50%;
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
		color: var(--accent-strong);
		font-size: var(--text-xl);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.controls button.play:hover { background: var(--accent); color: var(--abyss); }

	.lyrics-panel {
		flex: 1;
		min-width: 0;
		min-height: 0;
		max-width: min(46rem, 44vw);
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
		padding: 30vh var(--space-4);
		mask-image: linear-gradient(to bottom, transparent, var(--foreground) 22%, var(--foreground) 78%, transparent);
		-webkit-mask-image: linear-gradient(to bottom, transparent, var(--foreground) 22%, var(--foreground) 78%, transparent);
	}
	.lyric-line {
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--text-2xl);
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

	.art-skeleton { width: clamp(260px, 36vh, 460px); height: clamp(260px, 36vh, 460px); border-radius: var(--radius-lg); }
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
		.music-view {
			padding: var(--space-4);
			gap: var(--space-6);
		}
		.header {
			flex-wrap: wrap;
		}
		.player-body.with-lyrics {
			flex-direction: column;
			overflow: visible;
		}
		.with-lyrics .times,
		.with-lyrics .progress {
			width: min(540px, 70vw);
		}
		.lyrics-panel {
			max-width: 100%;
			max-height: 30vh;
		}
		.lyrics-panel.synced {
			padding: var(--space-4);
			mask-image: linear-gradient(to bottom, transparent, var(--foreground) 12%, var(--foreground) 88%, transparent);
			-webkit-mask-image: linear-gradient(to bottom, transparent, var(--foreground) 12%, var(--foreground) 88%, transparent);
		}
	}
</style>
