<script>
	let { phase = 'idle', size = 'sm' } = $props();

	let cell = $derived(size === 'lg' ? 1.8 : 0.7);
	let origin = $derived(size === 'lg' ? 0.7 : 0.35);
	let DOTS = $derived(
		Array.from({ length: 9 }, (_, i) => ({
			i,
			left: `${origin + (i % 3) * cell}rem`,
			top: `${origin + Math.floor(i / 3) * cell}rem`
		}))
	);

	let dim = $derived(phase === 'idle' || phase === 'done');
</script>

<div class="orbs" data-phase={phase} data-size={size} class:dim aria-hidden="true">
	{#each DOTS as d (d.i)}
		<span class="p" style="--i: {d.i}; left: {d.left}; top: {d.top}"></span>
	{/each}
</div>

<style>
	.orbs {
		position: relative;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		--orb-a: var(--text-tertiary);
		--orb-b: var(--brand);
		--orb-dur: 3.2s;
		--orb-travel: 5px;
		--orb-scale: 1;
		opacity: 0.4;
	}
	.orbs[data-size='lg'] {
		width: 6.5rem;
		height: 6.5rem;
	}
	.orbs[data-size='lg'] .p {
		width: 0.85rem;
		height: 0.85rem;
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
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 1px;
		background: var(--orb-a);
		box-shadow: 0 0 6px color-mix(in srgb, var(--orb-a) 55%, transparent);
	}
	.p:nth-child(odd) {
		background: var(--orb-b);
	}

	@media (prefers-reduced-motion: no-preference) {
		.orbs[data-phase='searching'] .p {
			animation: sweep var(--orb-dur) var(--spring-smooth) infinite;
			animation-delay: calc(var(--i) * 40ms);
		}
		.orbs[data-phase='solving'] .p,
		.orbs[data-phase='reasoning'] .p {
			animation: pulse var(--orb-dur) var(--spring-smooth) infinite;
			animation-delay: calc(var(--i) * 70ms);
		}
		.orbs[data-phase='working'] .p,
		.orbs[data-phase='executing'] .p {
			animation: field var(--orb-dur) var(--spring-smooth) infinite;
			animation-delay: calc(var(--i) * 30ms);
		}
		.orbs[data-phase='idle'] .p,
		.orbs[data-phase='done'] .p {
			animation: breathe 3.2s var(--spring-smooth) infinite;
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
