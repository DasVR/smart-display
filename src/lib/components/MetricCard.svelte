<script>
	import Sparkline from '$lib/components/Sparkline.svelte';

	let {
		label = '',
		value = '--',
		unit = '',
		hint = '',
		points = []
	} = $props();
</script>

<article class="metric-card">
	<div class="metric-label">{label}</div>
	<div class="metric-row">
		<div class="metric-value num">
			{value}<span class="metric-unit">{unit}</span>
		</div>
		{#if hint}
			<div class="metric-hint">{hint}</div>
		{/if}
	</div>
	<Sparkline {points} />
</article>

<style>
	.metric-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: 0 0 var(--space-2);
		min-height: 0;
		min-width: 0;
		color: var(--brand);
		border-bottom: 1px solid var(--border);
	}
	.metric-label {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.metric-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		min-width: 0;
	}
	.metric-value {
		font-size: clamp(3.2rem, 5vw, 5.4rem);
		font-weight: 650;
		letter-spacing: -0.05em;
		line-height: 0.92;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.metric-unit {
		margin-left: 6px;
		font-size: 0.32em;
		font-weight: 500;
		letter-spacing: 0;
		color: var(--text-tertiary);
	}
	.metric-hint {
		font-size: 14px;
		color: var(--text-tertiary);
	}
</style>
