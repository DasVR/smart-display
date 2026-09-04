<script>
	let { label = '', pct = 0, hint = '' } = $props();

	let clamped = $derived(Math.max(0, Math.min(100, Number(pct) || 0)));
	let tone = $derived(clamped >= 80 ? 'var(--warn)' : clamped >= 50 ? 'var(--solve)' : 'var(--ok)');
</script>

<div class="meter">
	<span class="lab">{label}</span>
	<span class="track" style="--fill: {clamped}%; --tone: {tone}">
		<span class="fill"></span>
	</span>
	<span class="pct num">{Math.round(clamped)}%</span>
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
		font-family: var(--font-body);
		font-size: var(--text-xl);
	}
	.lab {
		color: var(--text-secondary);
		font-weight: 500;
	}
	.track {
		position: relative;
		min-width: 0;
		height: 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		width: var(--fill, 0%);
		border-radius: 999px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--tone) 55%, transparent), var(--tone));
		box-shadow: 0 0 10px color-mix(in srgb, var(--tone) 65%, transparent);
		transition: width 480ms var(--spring-smooth);
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
