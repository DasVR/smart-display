<script>
	import { meterBar } from '$lib/agentFeed.js';

	let { label = '', pct = 0, hint = '', width = 12 } = $props();

	let bar = $derived(meterBar(pct, width));
	let tone = $derived(pct >= 80 ? 'var(--warn)' : pct >= 50 ? 'var(--solve)' : 'var(--ok)');
</script>

<div class="meter">
	<span class="lab">{label}</span>
	<span class="bar num" style="color: {tone}">[{bar}]</span>
	<span class="pct num">{Math.round(pct)}%</span>
	{#if hint}
		<span class="hint">{hint}</span>
	{/if}
</div>

<style>
	.meter {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr) 3.4rem minmax(0, 1fr);
		gap: var(--space-2);
		align-items: baseline;
		min-width: 0;
		min-height: 28px;
		font-family: var(--font-code);
		font-size: 14px;
		font-variant-ligatures: none;
	}
	.lab {
		color: var(--text-secondary);
		font-style: normal;
	}
	.bar {
		letter-spacing: 0.02em;
		overflow: hidden;
		min-width: 0;
	}
	.pct {
		color: var(--foreground);
		text-align: right;
	}
	.hint {
		color: var(--text-tertiary);
		font-size: 12px;
		overflow-wrap: anywhere;
		min-width: 0;
	}

	@media (max-width: 414px) {
		.meter {
			grid-template-columns: 4.5rem minmax(0, 1fr) auto;
		}
		.hint {
			grid-column: 1 / -1;
		}
	}
</style>
