<script>
	import Sparkline from '$lib/components/Sparkline.svelte';

	let {
		label = '',
		value = '--',
		unit = '',
		hint = '',
		points = [],
		warnAt = null
	} = $props();

	let hot = $derived(typeof value === 'number' && warnAt !== null && value >= warnAt);
	let display = $derived(typeof value === 'number' ? String(value) : value);
</script>

<article class="metric-card" class:hot>
	<div class="metric-copy">
		<span class="metric-label">{label}</span>
		{#if hint}
			<span class="metric-hint">{hint}</span>
		{/if}
	</div>
	<Sparkline {points} height={16} fill={false} />
	<div class="metric-readout">
		<span class="metric-value num">{display}</span>
		<span class="metric-unit">{unit}</span>
	</div>
</article>

<style>
	.metric-card {
		display: grid;
		grid-template-columns: 7rem minmax(48px, 1fr) 5.5rem;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: var(--space-8) 0;
		border-bottom: 1px solid var(--border);
		min-width: 0;
	}
	.metric-card:last-child {
		border-bottom: none;
	}
	.metric-copy {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
	}
	.metric-label {
		font-size: var(--text-lg);
		font-weight: 500;
		font-style: normal;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.metric-hint {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.metric-readout {
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: var(--space-1);
		min-width: 0;
	}
	.metric-value {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
		text-align: right;
		min-width: 3.5ch;
	}
	.metric-card.hot .metric-value {
		color: var(--warn);
	}
	.metric-unit {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}
</style>
