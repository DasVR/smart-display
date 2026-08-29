<script>
	import { nowPlaying } from '$lib/stores.js';
	import { onMount } from 'svelte';
	let mounted = false;
	onMount(() => { mounted = true; });

	// placeholder until we wire apple music / bluetooth audio
	let playing = {
		artist: 'Deftones',
		title: 'Change (In the House of Flies)',
		album: 'White Pony',
		cover: null,
		progress: 64
	};
</script>

<div class="music-view" class:mounted>
	<div class="album-art">
		<div class="vinyl-groove"></div>
		<div class="center-label">♪</div>
	</div>
	<div class="track-info">
		<div class="track-title">{playing.title}</div>
		<div class="track-artist">{playing.artist} — {playing.album}</div>
	</div>
	<div class="progress-bar">
		<div class="progress-fill" style="width: {playing.progress}%"></div>
	</div>
	<div class="controls">
		<button>⏮</button>
		<button class="play">▶</button>
		<button>⏭</button>
	</div>
	<div class="hint">bluetooth receiver mode coming soon</div>
</div>

<style>
	.music-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 32px;
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.22,1,0.36,1);
	}
	.music-view.mounted { opacity: 1; transform: translateY(0); }

	.album-art {
		width: 280px; height: 280px;
		border-radius: 24px;
		background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
		border: 1px solid rgba(255,255,255,0.08);
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03);
	}
	.vinyl-groove {
		position: absolute;
		inset: 24px;
		border-radius: 50%;
		border: 2px solid rgba(255,255,255,0.04);
		box-shadow: inset 0 0 40px rgba(0,0,0,0.4);
		animation: spin 8s linear infinite;
	}
	.vinyl-groove::before, .vinyl-groove::after {
		content: '';
		position: absolute;
		inset: 20px;
		border-radius: 50%;
		border: 1px solid rgba(255,255,255,0.03);
	}
	.vinyl-groove::after { inset: 40px; }
	@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
	.center-label {
		width: 64px; height: 64px;
		border-radius: 50%;
		background: #0a0a12;
		border: 2px solid rgba(255,255,255,0.08);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		color: rgba(255,255,255,0.2);
		z-index: 2;
	}

	.track-info { text-align: center; }
	.track-title { font-size: 24px; font-weight: 600; color: #f5f2ec; letter-spacing: -0.01em; }
	.track-artist { font-size: 14px; color: rgba(255,255,255,0.3); margin-top: 6px; }

	.progress-bar {
		width: 320px; height: 4px;
		background: rgba(255,255,255,0.06);
		border-radius: 999px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #452a84, #a9b1f0);
		border-radius: 999px;
		transition: width 0.3s ease;
	}

	.controls { display: flex; gap: 24px; align-items: center; }
	.controls button {
		background: none; border: none;
		color: rgba(255,255,255,0.4);
		font-size: 20px; cursor: pointer;
		transition: color 0.2s, transform 0.1s;
		padding: 8px;
	}
	.controls button:hover { color: #f5f2ec; }
	.controls button:active { transform: scale(0.92); }
	.controls button.play {
		width: 64px; height: 64px;
		border-radius: 50%;
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.1);
		color: #f5f2ec;
		font-size: 24px;
		display: flex; align-items: center; justify-content: center;
	}
	.controls button.play:hover { background: rgba(255,255,255,0.1); }

	.hint {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: rgba(255,255,255,0.1);
		letter-spacing: 0.08em;
		text-transform: lowercase;
	}
</style>
