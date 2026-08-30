<script>
	import { toBits } from '$lib/agentFeed.js';

	let { seed = 0, active = false } = $props();

	let bits = $derived(
		[toBits(seed, 8), toBits(seed * 3 + 13, 8), toBits(seed * 7 + 29, 8)].join(' ')
	);
</script>

<span class="bits" class:run={active} title={bits}>{bits}</span>

<style>
	.bits {
		display: inline-block;
		max-width: 11ch;
		overflow: hidden;
		white-space: nowrap;
		font-family: var(--font-code);
		font-size: var(--text-sm);
		letter-spacing: 0.04em;
		font-variant-ligatures: none;
		color: var(--text-tertiary);
		opacity: 0.55;
	}
	.bits.run {
		opacity: 0.85;
		color: var(--scan);
	}
	@media (prefers-reduced-motion: no-preference) {
		.bits.run {
			animation: tick var(--dur-slow) var(--ease-in-out) infinite;
		}
	}
	@keyframes tick {
		from { transform: translateX(0); }
		to { transform: translateX(-4px); }
	}
</style>
