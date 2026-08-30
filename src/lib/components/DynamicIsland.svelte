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
		<div class="chip" class:hot={gpuLowPower} class:busy={ollamaStatus === 'inferring'}>
			<span class="dot" aria-hidden="true"></span>
			<span class="word">{statusWord}</span>
		</div>
	{/if}
</div>

<style>
	.island {
		min-width: 0;
		flex-shrink: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 32px;
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
		color: var(--text-secondary);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ok);
		flex-shrink: 0;
	}
	.chip.busy .dot {
		background: var(--brand);
	}
	.chip.hot {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.chip.hot .dot {
		background: var(--warn);
	}
	.word {
		font-size: 13px;
		font-weight: 600;
		font-style: normal;
		line-height: 1;
	}
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 32px;
		max-width: min(280px, 100%);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
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
		font-size: 14px;
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 12px;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mini-vis {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		height: 24px;
		width: 48px;
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
		.slip {
			max-width: 100%;
		}
	}
</style>
