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
		<div class="word" class:hot={gpuLowPower}>[{statusWord}]</div>
	{/if}
</div>

<style>
	.island {
		min-width: 0;
		max-width: 100%;
	}
	.word {
		font-family: var(--font-display);
		font-size: 14px;
		font-weight: 600;
		color: var(--ok);
		letter-spacing: 0.04em;
	}
	.word.hot {
		color: var(--warn);
	}
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		min-width: 0;
		max-width: min(420px, 100%);
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
		font-size: 16px;
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
</style>
