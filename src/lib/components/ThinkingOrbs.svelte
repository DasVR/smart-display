<script>
	let { phase = 'idle' } = $props();

	const DOTS = Array.from({ length: 9 }, (_, i) => ({
		i,
		left: 8 + (i % 3) * 14,
		top: 8 + Math.floor(i / 3) * 14
	}));

	let dim = $derived(phase === 'idle' || phase === 'done');
</script>

<div class="orbs" data-phase={phase} class:dim aria-hidden="true">
	{#each DOTS as d (d.i)}
		<span class="p" style="--i: {d.i}; left: {d.left}px; top: {d.top}px"></span>
	{/each}
</div>

<style>
	.orbs {
		position: relative;
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		--orb-a: var(--text-tertiary);
		--orb-b: var(--brand);
		--orb-dur: 3.2s;
		--orb-travel: 5px;
		--orb-scale: 1;
		opacity: 0.4;
	}
	.orbs[data-phase='searching'] {
		--orb-a: var(--scan);
		--orb-b: var(--scan);
		--orb-dur: 0.7s;
		--orb-travel: 14px;
		opacity: 0.95;
	}
	.orbs[data-phase='solving'],
	.orbs[data-phase='reasoning'] {
		--orb-a: var(--solve);
		--orb-b: var(--brand);
		--orb-dur: 1.5s;
		--orb-travel: 3px;
		--orb-scale: 1.25;
		opacity: 0.95;
	}
	.orbs[data-phase='working'],
	.orbs[data-phase='executing'] {
		--orb-a: var(--ok);
		--orb-b: var(--ok);
		--orb-dur: 0.48s;
		--orb-travel: 11px;
		opacity: 1;
	}
	.p {
		position: absolute;
		width: 5px;
		height: 5px;
		border-radius: 1px;
		background: var(--orb-a);
		box-shadow: 0 0 6px color-mix(in srgb, var(--orb-a) 55%, transparent);
	}
	.p:nth-child(odd) {
		background: var(--orb-b);
	}

	@media (prefers-reduced-motion: no-preference) {
		.orbs[data-phase='searching'] .p {
			animation: sweep var(--orb-dur) var(--ease-in-out) infinite;
			animation-delay: calc(var(--i) * 40ms);
		}
		.orbs[data-phase='solving'] .p,
		.orbs[data-phase='reasoning'] .p {
			animation: pulse var(--orb-dur) var(--ease-in-out) infinite;
			animation-delay: calc(var(--i) * 70ms);
		}
		.orbs[data-phase='working'] .p,
		.orbs[data-phase='executing'] .p {
			animation: field var(--orb-dur) var(--ease-in-out) infinite;
			animation-delay: calc(var(--i) * 30ms);
		}
		.orbs[data-phase='idle'] .p,
		.orbs[data-phase='done'] .p {
			animation: breathe 3.2s var(--ease-in-out) infinite;
			animation-delay: calc(var(--i) * 120ms);
		}
	}

	@keyframes sweep {
		0%, 100% { transform: translateX(0); opacity: 0.35; }
		50% { transform: translateX(var(--orb-travel)); opacity: 1; }
	}
	@keyframes pulse {
		0%, 100% { transform: scale(0.75); opacity: 0.45; }
		50% { transform: scale(var(--orb-scale)); opacity: 1; }
	}
	@keyframes field {
		0%, 100% { transform: translate(0, 0); opacity: 0.4; }
		25% { transform: translate(var(--orb-travel), -3px); }
		75% { transform: translate(calc(var(--orb-travel) * -1), 3px); opacity: 1; }
	}
	@keyframes breathe {
		0%, 100% { opacity: 0.25; }
		50% { opacity: 0.55; }
	}
</style>
