<script>
	import { onMount } from 'svelte';
	let loading = true;
	let track = null;
	let error = null;

	onMount(() => {
		fetchNowPlaying();
		const t = setInterval(fetchNowPlaying, 3000);
		return () => clearInterval(t);
	});

	async function fetchNowPlaying() {
		try {
			const r = await fetch('/api/nowplaying');
			if (!r.ok) throw new Error('player failed');
			track = await r.json();
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
</script>

<div class="music-view">
	<div class="header">
		<h2 class="big-label">Music</h2>
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
			<p class="empty-copy">Connect bluetooth or start a track on the server.</p>
		</div>
	{:else}
		<div class="player-body">
			<div class="album-art" class:playing={track.playing}>
				<div class="vinyl-groove"></div>
				<div class="center-label"></div>
			</div>
			<div class="track-info">
				<div class="track-title">{track.title}</div>
				<div class="track-artist">{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
			</div>

			<div class="times">
				<span>{fmtTime(track.position)}</span>
				<span>{fmtTime(track.length)}</span>
			</div>
			<div class="progress" style="--p: {track.length ? track.position / track.length : 0}">
				<div class="progress-fill"></div>
			</div>

			<div class="controls">
				<button type="button" onclick={() => send('previous')}>prev</button>
				<button type="button" class="play" onclick={() => send('play-pause')}>{track.playing ? 'pause' : 'play'}</button>
				<button type="button" onclick={() => send('next')}>next</button>
			</div>
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
		justify-content: space-between;
		align-items: flex-end;
		gap: var(--space-4);
		border-bottom: 1px solid var(--hairline);
		padding-bottom: var(--space-6);
		min-width: 0;
	}
	.big-label {
		margin: 0;
		font-family: var(--font-body);
		font-size: clamp(2.25rem, 4.2vw, 3.75rem);
		font-weight: 700;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.055em;
		text-wrap: balance;
		overflow-wrap: anywhere;
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

	.album-art {
		width: clamp(260px, 36vh, 460px);
		height: clamp(260px, 36vh, 460px);
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
	}
</style>
