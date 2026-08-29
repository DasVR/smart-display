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

<div class="island-anchor" data-mode={mode}>
	<div class="dock" class:nowplaying={mode === 'nowplaying'} class:alert={mode === 'alert'}>
		{#if mode === 'nowplaying'}
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
		{:else if mode === 'alert'}
			<div class="copy">
				<div class="kicker">{modeLabel(mode)}</div>
				<div class="title">{notification.title}</div>
				<div class="sub">{notification.body}</div>
			</div>
		{:else}
			<div class="status" class:hot={gpuLowPower}>{statusWord}</div>
		{/if}
	</div>
</div>

<style>
	.island-anchor {
		display: flex;
		justify-content: center;
		pointer-events: none;
		min-width: 0;
	}
	.dock {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--card);
		border: 1px solid var(--border);
		color: var(--card-foreground);
		min-width: 0;
		max-width: min(620px, 100%);
		transition:
			min-width 0.4s var(--ease-enter),
			padding 0.4s var(--ease-enter);
	}
	.dock.nowplaying,
	.dock.alert {
		min-width: min(420px, 100%);
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
	.status {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.status.hot {
		color: var(--warn);
	}
	.mini-vis {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 28px;
		width: 72px;
		flex-shrink: 0;
		color: var(--brand);
	}
	.mini-vis span {
		flex: 1;
		min-width: 0;
		border-radius: var(--radius-sm);
		background: var(--brand);
		opacity: 0.85;
	}

	@media (max-width: 414px) {
		.dock.nowplaying,
		.dock.alert {
			min-width: 0;
			width: 100%;
		}
		.mini-vis {
			display: none;
		}
	}
</style>
