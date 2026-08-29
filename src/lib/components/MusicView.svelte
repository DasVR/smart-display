<script>
	import { onMount } from 'svelte';
	let mounted = false;
	let loading = true;
	let track = null;
	let error = null;

	onMount(() => {
		mounted = true;
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
</script>

<div class="view-shell music-view" class:mounted>
	{#if loading}
		<div class="skeleton art-skeleton"></div>
		<div class="skeleton title-skeleton"></div>
		<div class="skeleton bar-skeleton"></div>
	{:else if error || !track || !track.playing}
		<div class="empty-state">
			<div class="empty-title">no music playing</div>
			<div>connect bluetooth or play on the server</div>
		</div>
	{:else}
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
		<div class="progress">
			<div class="progress-fill" style="width:{track.length ? (track.position / track.length) * 100 : 0}%"></div>
		</div>
		<div class="controls">
			<button aria-label="Previous">prev</button>
			<button class="play" aria-label="Play/Pause">{track.playing ? 'pause' : 'play'}</button>
			<button aria-label="Next">next</button>
		</div>
	{/if}
</div>

<style>
	.music-view {
		align-items: center;
		justify-content: center;
		gap: 34px;
		text-align: center;
	}

	.album-art {
		width: 320px; height: 320px;
		border-radius: var(--r-lg);
		background: linear-gradient(135deg, #12121c, #0b0b12);
		border: 1px solid var(--surface-border);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
		box-shadow: 0 24px 70px rgba(0,0,0,0.6);
	}
	.album-art.playing .vinyl-groove {
		animation: spin 8s linear infinite;
	}
	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
	.vinyl-groove {
		position: absolute;
		inset: 26px;
		border-radius: 50%;
		border: 2px solid rgba(255,255,255,0.04);
		box-shadow: inset 0 0 50px rgba(0,0,0,0.5);
	}
	.vinyl-groove::before, .vinyl-groove::after {
		content: '';
		position: absolute;
		inset: 32px;
		border-radius: 50%;
		border: 1px solid rgba(255,255,255,0.03);
	}
	.vinyl-groove::after { inset: 56px; }
	.center-label {
		width: 70px; height: 70px;
		border-radius: 50%;
		background: #12121c;
		border: 2px solid rgba(255,255,255,0.07);
		z-index: 2;
	}

	.track-title { font-size: 32px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
	.track-artist { font-size: 18px; color: var(--text-secondary); margin-top: 8px; }

	.times {
		display: flex;
		justify-content: space-between;
		width: 380px;
		font-family: var(--font-display);
		font-size: 14px;
		color: var(--text-tertiary);
	}
	.progress {
		width: 380px; height: 6px;
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
		gap: 28px;
	}
	.controls button {
		background: none; border: none;
		color: var(--text-secondary);
		font-family: var(--font-display);
		font-size: 16px;
		letter-spacing: 0.04em;
		cursor: pointer;
		padding: 12px;
		transition: color 0.15s;
	}
	.controls button:hover { color: var(--accent); }
	.controls button.play {
		width: 78px; height: 78px;
		border-radius: 50%;
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
		color: var(--accent-strong);
		font-size: 18px;
		display: flex; align-items: center; justify-content: center;
	}
	.controls button.play:hover { background: var(--accent); color: #08080d; }

	.art-skeleton { width: 320px; height: 320px; border-radius: var(--r-lg); }
	.title-skeleton { width: 260px; height: 32px; }
	.bar-skeleton { width: 380px; height: 6px; border-radius: 999px; }
</style>
