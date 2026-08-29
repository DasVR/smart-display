<script>
	import { spectrum } from '$lib/services/audioReactive.js';
	import { wsStatus } from '$lib/stores.js';
	import { gpuLowPowerMode, ollamaStatus } from '$lib/services/ollamaArbiter.js';

	let { weather = { temp: '--', desc: '--' } } = $props();
	let bars = $derived($spectrum || []);
</script>

<div class="ambient-deck">
	<div class="wave-bars" aria-hidden="true">
		{#each bars as h, i (i)}
			<div class="wave" style="--h: {0.12 + h * 0.88}"></div>
		{/each}
	</div>
	<div class="pills">
		<span class="pill" class:ok={$wsStatus === 'connected'}>
			{$wsStatus === 'connected' ? 'link' : 'offline'}
		</span>
		<span class="pill" class:hot={$gpuLowPowerMode}>
			{$gpuLowPowerMode ? 'gpu yield' : 'gpu live'}
		</span>
		<span class="pill">{$ollamaStatus === 'inferring' ? 'ollama' : 'idle'}</span>
		<span class="pill dim">{weather.temp}° {weather.desc}</span>
	</div>
</div>

<style>
	.ambient-deck {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 18px;
		padding-bottom: 18px;
		pointer-events: none;
	}
	.wave-bars {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 6px;
		width: min(70vw, 1100px);
		height: 42%;
		opacity: 0.55;
	}
	.wave {
		flex: 1;
		max-width: 18px;
		height: calc(var(--h) * 100%);
		border-radius: 999px;
		background: linear-gradient(180deg, rgba(226, 232, 255, 0.55), rgba(129, 140, 248, 0.05));
		box-shadow: 0 0 12px rgba(165, 180, 252, 0.12);
	}
	.pills {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.pill {
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		padding: 6px 12px;
		border-radius: 999px;
		color: rgb(148, 163, 184);
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(2, 6, 23, 0.35);
		backdrop-filter: blur(12px);
	}
	.pill.ok {
		color: rgb(52, 211, 153);
		border-color: rgba(52, 211, 153, 0.28);
	}
	.pill.hot {
		color: rgb(251, 191, 36);
		border-color: rgba(251, 191, 36, 0.35);
	}
	.pill.dim {
		opacity: 0.7;
	}
</style>
