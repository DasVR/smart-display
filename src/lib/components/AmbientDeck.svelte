<script>
	import { spectrum } from '$lib/services/audioReactive.js';
	import { wsStatus } from '$lib/stores.js';

	let bars = $derived($spectrum || []);
</script>

<div class="ambient-deck">
	<div class="wave-bars" aria-hidden="true">
		{#each bars as h, i (i)}
			<div class="wave" style="--h: {0.12 + h * 0.88}"></div>
		{/each}
	</div>
	<p class="link" class:ok={$wsStatus === 'connected'}>
		{$wsStatus === 'connected' ? '[SYS_OK]' : '[LNK_DN]'}
	</p>
</div>

<style>
	.ambient-deck {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		pointer-events: none;
		box-sizing: border-box;
		min-width: 0;
	}
	.wave-bars {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 8px;
		width: min(56vw, 720px);
		height: 58%;
		opacity: 0.45;
	}
	.wave {
		flex: 1;
		max-width: 8px;
		min-width: 0;
		height: calc(var(--h) * 100%);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 40%, transparent);
	}
	.link {
		margin: 0;
		font-family: var(--font-display);
		font-size: 13px;
		color: var(--text-tertiary);
	}
	.link.ok {
		color: var(--ok);
	}
</style>
