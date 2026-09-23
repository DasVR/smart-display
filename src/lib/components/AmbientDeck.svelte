<script>
	import { spectrum } from '$lib/services/audioReactive.js';
	import { wsStatus } from '$lib/stores.js';
	import BoardWidgets from './BoardWidgets.svelte';

	// The clock face already shows the same Sun / Wind / Radar chips at full
	// size, so the page turns them off here on that view instead of repeating them.
	let { atm = null, prediction = null, showWidgets = true } = $props();

	let bars = $derived($spectrum || []);
</script>

<div class="ambient-deck">
	{#if atm && showWidgets}
		<BoardWidgets {atm} {prediction} compact />
	{/if}
	<div class="wave-bars" aria-hidden="true">
		{#each bars as h, i (i)}
			<div class="wave" style="--h: {0.12 + h * 0.88}"></div>
		{/each}
	</div>
	<p class="link" class:ok={$wsStatus === 'connected'}>
		<span class="link-dot" aria-hidden="true"></span>
		{$wsStatus === 'connected' ? 'Connected' : 'Reconnecting'}
	</p>
</div>

<style>
	.ambient-deck {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-6);
		pointer-events: none;
		box-sizing: border-box;
		min-width: 0;
	}
	.wave-bars {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: var(--space-2);
		grid-column: 2;
		width: 100%;
		height: 100%;
		opacity: 0.85;
	}
	.wave {
		flex: 1;
		max-width: 8px;
		min-width: 0;
		height: 100%;
		transform: scaleY(var(--h));
		/* grow from the midline so the bars sit on the same axis as the
		   labels either side of them */
		transform-origin: center;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 40%, transparent);
	}
	@media (prefers-reduced-motion: no-preference) {
		.wave {
			transition: transform 110ms linear;
		}
	}
	.link {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-tertiary);
		grid-column: 3;
	}
	.link-dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.5;
	}
	.link.ok {
		color: var(--ok);
	}
	.link.ok .link-dot {
		opacity: 1;
		box-shadow: 0 0 8px color-mix(in srgb, var(--ok) 70%, transparent);
	}
</style>
