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
		gap: var(--space-8);
		padding: var(--space-8);
		pointer-events: none;
		box-sizing: border-box;
		min-width: 0;
	}
	.wave-bars {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: var(--space-2);
		width: min(56vw, 720px);
		height: 58%;
		opacity: 0.45;
	}
	.wave {
		flex: 1;
		max-width: 8px;
		min-width: 0;
		height: 100%;
		transform: scaleY(var(--h));
		transform-origin: center bottom;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 40%, transparent);
	}
	@media (prefers-reduced-motion: no-preference) {
		.wave {
			transition: transform 180ms var(--spring-smooth);
		}
	}
	.link {
		margin: 0;
		font-family: var(--font-code);
		font-size: var(--text-lg);
		color: var(--text-tertiary);
	}
	.link.ok {
		color: var(--ok);
	}
</style>
