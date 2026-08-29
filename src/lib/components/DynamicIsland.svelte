<script>
	import { spectrum } from '$lib/services/audioReactive.js';

	let {
		nowPlaying = null,
		notification = { visible: false, title: '', body: '', kind: 'info' },
		gpuLowPower = false,
		ollamaStatus = 'idle'
	} = $props();

	let mode = $derived.by(() => {
		if (notification?.visible) return 'alert';
		if (nowPlaying?.playing) return 'nowplaying';
		return 'idle';
	});

	let bins = $derived(($spectrum || []).slice(0, 10));

	let statusWord = $derived.by(() => {
		if (gpuLowPower) return 'yield';
		if (ollamaStatus === 'inferring') return 'busy';
		return 'ready';
	});

	function modeLabel(next) {
		switch (next) {
			case 'idle':
				return statusWord;
			case 'nowplaying':
				return 'playing';
			case 'alert':
				return notification?.kind || 'notice';
			default: {
				const _exhaustive = next;
				return _exhaustive;
			}
		}
	}
</script>

<div class="island" data-mode={mode}>
	{#if mode === 'nowplaying'}
		<div class="slip">
			<div class="copy">
				<div class="kicker">{modeLabel(mode)}</div>
				<div class="title">{nowPlaying?.title || 'Untitled'}</div>
				<div class="sub">{nowPlaying?.artist || ''}</div>
			</div>
			<div class="mini-vis" aria-hidden="true">
				{#each bins as h, i (i)}
					<span style="height: {Math.max(12, h * 100)}%"></span>
				{/each}
			</div>
		</div>
	{:else if mode === 'alert'}
		<div class="slip">
			<div class="copy">
				<div class="kicker">{modeLabel(mode)}</div>
				<div class="title">{notification.title}</div>
				<div class="sub">{notification.body}</div>
			</div>
		</div>
	{:else}
		<div class="word" class:hot={gpuLowPower}>{statusWord}</div>
	{/if}
</div>

<style>
	.island {
		min-width: 0;
		max-width: 100%;
	}
	.word {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.word.hot {
		color: var(--warn);
	}
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 44px;
		padding: var(--space-2) 0;
		border-top: 1px solid var(--border);
		max-width: min(420px, 100%);
	}
	.copy {
		min-width: 0;
		flex: 1;
	}
	.kicker {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.title {
		font-size: 18px;
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 13px;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mini-vis {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 28px;
		width: 72px;
		flex-shrink: 0;
	}
	.mini-vis span {
		flex: 1;
		min-width: 0;
		border-radius: var(--radius-sm);
		background: var(--brand);
		opacity: 0.85;
	}

	@media (max-width: 414px) {
		.mini-vis {
			display: none;
		}
	}
</style>
