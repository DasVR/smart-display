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
		gap: 4px var(--space-2);
		align-items: center;
		min-width: 0;
		font-family: var(--font-code);
		font-size: 14px;
		font-variant-ligatures: none;
	}
	.lab {
		color: var(--text-secondary);
		font-style: normal;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
		height: 16px;
	}
	.br {
		color: var(--text-tertiary);
		font-size: var(--type-floor);
	}
	.cell {
		width: 8px;
		height: 12px;
		flex-shrink: 0;
		border-radius: 1px;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		background: transparent;
	}
	.cell.on {
		background: currentColor;
		border-color: currentColor;
	}
	.pct {
		color: var(--foreground);
		text-align: right;
	}
	.hint {
		grid-column: 2 / -1;
		color: var(--text-tertiary);
		font-size: var(--type-floor);
		overflow-wrap: anywhere;
		min-width: 0;
	}
</style>
