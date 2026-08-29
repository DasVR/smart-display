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

	function send(action) {
		fetch('/api/player/' + action, { method: 'POST' }).catch(() => {});
	}
</script>

<div class="music-view" class:mounted>
	<div class="header">
		<div class="big-label">MUSIC</div>
		<div class="sub">{track?.playing ? 'now playing' : 'idle'}</div>
	</div>

	{#if loading}
		<div class="player-body">
			<div class="skeleton art-skeleton"></div>
			<div class="skeleton title-skeleton"></div>
			<div class="skeleton bar-skeleton"></div>
		</div>
	{:else if error || !track || !track.playing}
		<div class="empty">
			<div class="empty-title">no music playing</div>
			<div>connect bluetooth or play on the server</div>
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
			<div class="progress">
				<div class="progress-fill" style="width:{track.length ? (track.position / track.length) * 100 : 0}%"></div>
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
		padding: 110px 80px 60px;
		gap: 40px;
		opacity: 0;
		transform: translateY(14px);
		transition: opacity 0.5s var(--ease-standard), transform 0.6s var(--ease-standard);
	}
	.music-view.mounted { opacity: 1; transform: translateY(0); }

	.header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		padding-bottom: 28px;
	}
	.big-label {
		font-family: var(--font-display);
		font-size: clamp(42px, 5vw, 72px);
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}
	.sub { font-size: clamp(18px, 1.6vw, 26px); color: var(--text-secondary); }

	.player-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 40px;
	}

	.album-art {
		width: clamp(260px, 36vh, 460px);
		height: clamp(260px, 36vh, 460px);
		border-radius: var(--r-lg);
		background: linear-gradient(135deg, #12121c, #0b0b12);
		border: 1px solid var(--surface-border);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
		box-shadow: 0 40px 100px rgba(0,0,0,0.6);
	}
	.album-art.playing .vinyl-groove { animation: spin 8s linear infinite; }
	@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
	.vinyl-groove {
		position: absolute;
		inset: clamp(24px, 4vh, 48px);
		border-radius: 50%;
		border: 2px solid rgba(255,255,255,0.04);
		box-shadow: inset 0 0 50px rgba(0,0,0,0.5);
	}
	.vinyl-groove::before, .vinyl-groove::after {
		content: '';
		position: absolute;
		border-radius: 50%;
		border: 1px solid rgba(255,255,255,0.03);
	}
	.vinyl-groove::before { inset: clamp(20px, 3vh, 36px); }
	.vinyl-groove::after { inset: clamp(48px, 7vh, 80px); }
	.center-label {
		width: clamp(56px, 8vh, 90px);
		height: clamp(56px, 8vh, 90px);
		border-radius: 50%;
		background: #12121c;
		border: 2px solid rgba(255,255,255,0.07);
		z-index: 2;
	}

	.track-info { text-align: center; }
	.track-title { font-size: clamp(30px, 3.4vw, 56px); font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
	.track-artist { font-size: clamp(18px, 1.8vw, 30px); color: var(--text-secondary); margin-top: 10px; }

	.times {
		display: flex;
		justify-content: space-between;
		width: min(540px, 70vw);
		font-family: var(--font-display);
		font-size: clamp(14px, 1.4vw, 22px);
		color: var(--text-tertiary);
	}
	.progress {
		width: min(540px, 70vw);
		height: 10px;
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
		gap: 36px;
	}
	.controls button {
		background: none; border: none;
		color: var(--text-secondary);
		font-family: var(--font-display);
		font-size: clamp(16px, 1.6vw, 24px);
		letter-spacing: 0.04em;
		cursor: pointer;
		padding: 14px;
		transition: color 0.15s;
	}
	.controls button:hover { color: var(--accent); }
	.controls button.play {
		width: clamp(80px, 10vh, 120px);
		height: clamp(80px, 10vh, 120px);
		border-radius: 50%;
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
		color: var(--accent-strong);
		font-size: clamp(18px, 2vw, 28px);
		display: flex; align-items: center; justify-content: center;
	}
	.controls button.play:hover { background: var(--accent); color: #08080d; }

	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: var(--text-tertiary);
		font-size: 24px;
	}
	.empty-title { font-size: 34px; color: var(--text-secondary); font-weight: 600; }

	.art-skeleton { width: clamp(260px, 36vh, 460px); height: clamp(260px, 36vh, 460px); border-radius: var(--r-lg); }
	.title-skeleton { width: 340px; height: 44px; }
	.bar-skeleton { width: min(540px, 70vw); height: 10px; border-radius: 999px; }
</style>
