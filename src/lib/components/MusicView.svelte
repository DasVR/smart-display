<script>
	import { onMount } from 'svelte';
	import { nowPlaying } from '$lib/stores.js';
	let mounted = false;
	let loading = true;
	onMount(() => {
		mounted = true;
		setTimeout(() => { loading = false; }, 600);
	});

	// PLACEHOLDER until bluetooth receiver / apple-music metadata lands
	let track = {
		artist: 'Deftones',
		title: 'Change (In the House of Flies)',
		album: 'White Pony',
		progress: 64
	};
</script>

<div class="view-shell music-view" class:mounted>
	{#if loading}
		<div class="skeleton art-skeleton"></div>
		<div class="skeleton title-skeleton"></div>
		<div class="skeleton bar-skeleton"></div>
	{:else}
		<div class="album-art">
			<div class="vinyl-groove"></div>
			<div class="center-label"></div>
		</div>
		<div class="track-info">
			<div class="track-title">{track.title}</div>
			<div class="track-artist">{track.artist} - {track.album}</div>
		</div>
		<div class="progress">
			<div class="progress-fill" style="width:{track.progress}%"></div>
		</div>
		<div class="controls">
			<button aria-label="Previous">prev</button>
			<button class="play" aria-label="Play">play</button>
			<button aria-label="Next">next</button>
		</div>
		<div class="api-note">bluetooth receiver coming</div>
	{/if}
</div>

<style>
	.music-view {
		align-items: center;
		justify-content: center;
		gap: 30px;
		text-align: center;
	}

	.album-art {
		width: 260px; height: 260px;
		border-radius: var(--r-lg);
		background: linear-gradient(135deg, #12121c, #0b0b12);
		border: 1px solid var(--surface-border);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
	}
	/* vinyl kept subtle, no spin until real playback */
	.vinyl-groove {
		position: absolute;
		inset: 22px;
		border-radius: 50%;
		border: 2px solid rgba(255,255,255,0.04);
		box-shadow: inset 0 0 50px rgba(0,0,0,0.5);
	}
	.vinyl-groove::before, .vinyl-groove::after {
		content: '';
		position: absolute;
		inset: 26px;
		border-radius: 50%;
		border: 1px solid rgba(255,255,255,0.03);
	}
	.vinyl-groove::after { inset: 46px; }
	.center-label {
		width: 58px; height: 58px;
		border-radius: 50%;
		background: #12121c;
		border: 2px solid rgba(255,255,255,0.07);
		z-index: 2;
	}

	.track-title { font-size: 22px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
	.track-artist { font-size: 13px; color: var(--text-tertiary); margin-top: 6px; }

	.progress {
		width: 300px; height: 4px;
		background: var(--surface);
		border-radius: 999px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
		transition: width 0.4s var(--ease-enter);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 22px;
	}
	.controls button {
		background: none; border: none;
		color: var(--text-secondary);
		font-family: var(--font-display);
		font-size: 13px;
		letter-spacing: 0.04em;
		cursor: pointer;
		padding: 10px;
		transition: color 0.15s;
	}
	.controls button:hover { color: var(--accent); }
	.controls button.play {
		width: 62px; height: 62px;
		border-radius: 50%;
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
		color: var(--accent-strong);
		font-size: 15px;
		display: flex; align-items: center; justify-content: center;
	}
	.controls button.play:hover { background: var(--accent); color: #08080d; }

	.api-note {
		font-family: var(--font-display);
		font-size: 11px;
		color: var(--text-tertiary);
		letter-spacing: 0.08em;
	}

	.art-skeleton { width: 260px; height: 260px; border-radius: var(--r-lg); }
	.title-skeleton { width: 220px; height: 24px; }
	.bar-skeleton { width: 300px; height: 4px; border-radius: 999px; }
</style>
