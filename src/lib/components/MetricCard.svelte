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
</script>

<article class="metric-card" class:hot>
	<div class="metric-line">
		<span class="metric-label">{label}</span>
		<Sparkline {points} height={16} fill={false} />
		<span class="metric-value num">
			{value}<span class="metric-unit">{unit}</span>
		</span>
	</div>
	{#if hint}
		<div class="metric-hint">{hint}</div>
	{/if}
</article>

<style>
	.metric-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-4);
		min-height: 0;
		min-width: 0;
		border-right: 1px solid var(--border);
	}
	.metric-card:first-child {
		padding-left: 0;
	}
	.metric-card:last-child {
		padding-right: 0;
		border-right: none;
	}
	.metric-line {
		display: grid;
		grid-template-columns: auto minmax(40px, 1fr) auto;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		min-height: 32px;
	}
	.metric-label {
		font-size: 12px;
		font-weight: 500;
		font-style: normal;
		color: var(--text-tertiary);
	}
	.metric-value {
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
		text-align: right;
	}
	.metric-card.hot .metric-value {
		color: var(--warn);
	}
	.metric-unit {
		margin-left: var(--space-1);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0;
		color: var(--text-tertiary);
	}
	.metric-hint {
		font-size: 12px;
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
		min-width: 0;
		padding-left: 0;
	}

	@media (max-width: 414px) {
		.metric-card {
			padding: var(--space-2) 0;
			border-right: none;
			border-bottom: 1px solid var(--border);
		}
		.metric-card:last-child {
			border-bottom: none;
		}
	}
</style>
