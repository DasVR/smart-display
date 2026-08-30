<script>
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

	let statusWord = $derived.by(() => {
		if (gpuLowPower) return 'YIELD';
		if (ollamaStatus === 'inferring') return 'BUSY';
		return 'SYS_OK';
	});

	function modeLabel(next) {
		switch (next) {
			case 'idle':
				return statusWord;
			case 'nowplaying':
				return 'PLAY';
			case 'alert':
				return notification?.kind || 'NOTE';
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
				<div class="kicker">[{modeLabel(mode)}]</div>
				<div class="title">{nowPlaying?.title || 'Untitled'}</div>
				<div class="sub">{nowPlaying?.artist || ''}</div>
			</div>
		</div>
	{:else if mode === 'alert'}
		<div class="slip">
			<div class="copy">
				<div class="kicker">[{modeLabel(mode)}]</div>
				<div class="title">{notification.title}</div>
				<div class="sub">{notification.body}</div>
			</div>
		</div>
	{:else}
		<div class="chip" class:hot={gpuLowPower} class:busy={ollamaStatus === 'inferring'}>
			<span class="dot" aria-hidden="true"></span>
			<span class="word">[{statusWord}]</span>
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
		color: var(--ok);
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
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 600;
		font-style: normal;
		line-height: 1;
		letter-spacing: 0.04em;
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
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.title {
		font-family: var(--font-display);
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

	@media (max-width: 414px) {
		.slip {
			max-width: 100%;
		}
	}
</style>
