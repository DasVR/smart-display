<script>
	import { spectrum } from '$lib/services/audioReactive.js';
	import { wsStatus } from '$lib/stores.js';
	import { gpuLowPowerMode, ollamaStatus } from '$lib/services/ollamaArbiter.js';

	let bars = $derived($spectrum || []);
</script>

<div class="ambient-deck">
	<div class="wave-bars" aria-hidden="true">
		{#each bars as h, i (i)}
			<div class="wave" style="--h: {0.12 + h * 0.88}"></div>
		{/each}
	</div>
	<ul class="status">
		<li class:ok={$wsStatus === 'connected'}>
			{$wsStatus === 'connected' ? 'link' : 'offline'}
		</li>
		<li class:hot={$gpuLowPowerMode}>
			{$gpuLowPowerMode ? 'yield' : 'live'}
		</li>
		<li>{$ollamaStatus === 'inferring' ? 'ollama' : 'idle'}</li>
	</ul>
</div>

<style>
	.ambient-deck {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-4);
		padding: var(--space-4);
		pointer-events: none;
		box-sizing: border-box;
		min-width: 0;
	}
	.wave-bars {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 6px;
		width: min(70vw, 1100px);
		height: 42%;
		opacity: 0.5;
	}
	.wave {
		flex: 1;
		max-width: 14px;
		min-width: 0;
		height: calc(var(--h) * 100%);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 42%, transparent);
	}
	.status {
		display: flex;
		gap: var(--space-5);
		flex-wrap: wrap;
		justify-content: center;
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 13px;
		color: var(--text-tertiary);
	}
	.status li.ok {
		color: var(--ok);
	}
	.status li.hot {
		color: var(--warn);
	}
</style>
