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
		if (alerts.length) return 'Weather alert';
		const p = weatherData?.prediction || {};
		if (p.rain30min >= 0.6) return 'Rain in 30 min';
		if (p.rain60min >= 0.6) return 'Rain in an hour';
		if (p.rain120min >= 0.6) return 'Rain in 2 hours';
		return 'Clear skies';
	});

	let statusWord = $derived.by(() => {
		if (gpuLowPower) return 'Power saving';
		if (ollamaStatus === 'inferring') return 'Thinking';
		return 'All good';
	});

	function modeLabel(next) {
		switch (next) {
			case 'idle':
				return statusWord;
			case 'nowplaying':
				return 'Now playing';
			case 'alert':
				return notification?.kind === 'warn' ? 'Alert' : 'Notice';
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
	{#key mode}
		{#if mode === 'nowplaying'}
			<div class="slip">
				<div class="copy">
					<div class="kicker">{modeLabel(mode)}</div>
					<div class="title">{nowPlaying?.title || 'Untitled'}</div>
					<div class="sub">{nowPlaying?.artist || ''}</div>
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
			<div
				class="chip"
				class:hot={gpuLowPower}
				class:busy={ollamaStatus === 'inferring'}
				class:weather={mode === 'weather'}
			>
				<span class="dot" aria-hidden="true"></span>
				<span class="word">{modeLabel(mode)}</span>
			</div>
		{/if}
	{/key}
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
		min-height: 2.75rem;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
		color: var(--ok);
		transition:
			transform 280ms var(--spring-smooth),
			color 280ms var(--spring-smooth);
	}
	.chip:active {
		transform: scale(0.98);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ok);
		box-shadow: 0 0 10px color-mix(in srgb, var(--ok) 70%, transparent);
		flex-shrink: 0;
		transform-origin: center;
	}
	.chip.busy .dot {
		background: var(--brand);
		box-shadow: 0 0 10px color-mix(in srgb, var(--brand) 70%, transparent);
	}
	.chip.hot,
	.chip.weather {
		color: var(--warn);
	}
	.chip.hot .dot,
	.chip.weather .dot {
		background: var(--warn);
		box-shadow: 0 0 10px color-mix(in srgb, var(--warn) 70%, transparent);
	}
	.word {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 500;
		font-style: normal;
		line-height: 1;
		letter-spacing: -0.01em;
	}
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		max-width: min(36rem, 100%);
		padding: 0;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
	}
	.copy {
		min-width: 0;
		flex: 1;
	}
	.kicker {
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text-tertiary);
	}
	.title {
		font-family: var(--font-body);
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

	@media (prefers-reduced-motion: no-preference) {
		.slip {
			animation: island-in 480ms var(--spring-smooth) both;
		}
		.chip.hot .dot,
		.chip.weather .dot {
			animation: yield-mark 1.8s var(--spring-smooth) infinite;
		}
	}

	@media (max-width: 414px) {
		.slip {
			max-width: 100%;
		}
		.word {
			font-size: var(--text-sm);
		}
	}
</style>
