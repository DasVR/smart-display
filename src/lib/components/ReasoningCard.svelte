<script>
	let { title = 'Reasoning', phase = 'done', lines = [], open = false } = $props();
</script>

<details class="card" open={open}>
	<summary>
		<span class="mark">::</span>
		<span class="kind">Reasoning</span>
		<span class="phase">{phase}</span>
		<span class="ttl">{title}</span>
	</summary>
	{#if lines.length}
		<pre class="body">{lines.join('\n')}</pre>
	{:else}
		<p class="empty">no trace this cycle</p>
	{/if}
</details>

<style>
	.card {
		border-top: 1px solid var(--border);
		padding: var(--space-2) 0;
		min-width: 0;
	}
	summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		cursor: pointer;
		list-style: none;
		min-height: 2.75rem;
		min-width: 0;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.mark,
	.kind,
	.phase {
		font-family: var(--font-code);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.kind {
		color: var(--brand);
	}
	.ttl {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.body {
		margin: 0;
		padding: var(--space-2) 0 0;
		font-family: var(--font-code);
		font-size: var(--text-lg);
		line-height: 1.45;
		color: var(--text-secondary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.empty {
		margin: var(--space-1) 0 0;
		font-size: var(--text-lg);
		color: var(--text-tertiary);
	}
</style>
