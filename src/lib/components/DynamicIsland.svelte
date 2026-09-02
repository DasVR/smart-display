<script>
	let {
		nowPlaying = null,
		notification = { visible: false, title: '', body: '', kind: 'info' },
		gpuLowPower = false,
		ollamaStatus = 'idle',
		weatherData = null
	} = $props();

	let mode = $derived.by(() => {
		if (notification?.visible) return 'alert';
		if (weatherData?.alerts?.length) return 'weather';
		if (weatherData?.prediction?.rain60min >= 0.35) return 'weather';
		if (nowPlaying?.playing) return 'nowplaying';
		return 'idle';
	});

	let weatherWord = $derived.by(() => {
		const alerts = weatherData?.alerts || [];
		if (alerts.length) return 'ALERT';
		const p = weatherData?.prediction || {};
		if (p.rain30min >= 0.6) return 'RAIN 30m';
		if (p.rain60min >= 0.6) return 'RAIN 1h';
		if (p.rain120min >= 0.6) return 'RAIN 2h';
		return 'CLEAR';
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
			case 'weather':
				return weatherWord;
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
		<div class="chip" class:hot={gpuLowPower} class:busy={ollamaStatus === 'inferring'} class:weather={mode === 'weather'}>
			<span class="dot" aria-hidden="true"></span>
			<span class="word">[{modeLabel(mode)}]</span>
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
		height: 2.75rem;
		padding: 0 var(--space-6);
		border: 1px solid var(--hairline);
		border-radius: 999px;
		background: var(--shell-fill);
		box-shadow: var(--inset-spec);
		color: var(--ok);
		transition: transform 500ms var(--ease-fluid);
	}
	.chip:active {
		transform: scale(0.98);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
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
	.chip.weather {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.chip.weather .dot {
		background: var(--warn);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
	.word {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 600;
		font-style: normal;
		line-height: 1;
		letter-spacing: 0.04em;
	}
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		max-width: min(28rem, 100%);
		padding: var(--space-4) var(--space-6);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-bezel-inner);
		background: var(--shell-fill);
		box-shadow: var(--inset-spec);
	}
	.copy {
		min-width: 0;
		flex: 1;
	}
	.kicker {
		font-family: var(--font-display);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: var(--text-sm);
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
