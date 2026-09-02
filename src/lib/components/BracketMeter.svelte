<script>
	let { label = '', pct = 0, hint = '', width = 12 } = $props();

	let filled = $derived(Math.round((Math.max(0, Math.min(100, Number(pct) || 0)) / 100) * width));
	let tone = $derived(pct >= 80 ? 'var(--warn)' : pct >= 50 ? 'var(--solve)' : 'var(--ok)');
	let cells = $derived(Array.from({ length: width }, (_, i) => i < filled));
</script>

<div class="meter">
	<span class="lab">{label}</span>
	<span class="bar num" style="color: {tone}">
		<span class="br">[</span>
		{#each cells as on, i (i)}
			<span class="cell" class:on></span>
		{/each}
		<span class="br">]</span>
	</span>
	<span class="pct num">{Math.round(pct)}%</span>
	{#if hint}
		<span class="hint">{hint}</span>
	{/if}
</div>

<style>
	.meter {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr) 3.4rem;
		gap: var(--space-2) var(--space-4);
		align-items: center;
		min-width: 0;
		min-height: 2.75rem;
		font-family: var(--font-code);
		font-size: var(--text-xl);
		font-variant-ligatures: none;
	}
	.lab {
		color: var(--text-secondary);
		font-style: normal;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		min-width: 0;
		height: 1.25rem;
	}
	.br {
		color: var(--text-tertiary);
		font-size: var(--text-lg);
	}
	.cell {
		width: 0.5rem;
		height: 0.875rem;
		flex-shrink: 0;
		border-radius: 1px;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		background: transparent;
		opacity: 0.4;
		transition:
			background-color 380ms var(--spring-smooth),
			border-color 380ms var(--spring-smooth),
			opacity 380ms var(--spring-smooth);
	}
	.cell.on {
		background: currentColor;
		border-color: currentColor;
		opacity: 1;
	}
	.pct {
		color: var(--foreground);
		text-align: right;
	}
	.hint {
		grid-column: 2 / -1;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
		min-width: 0;
	}
</style>
