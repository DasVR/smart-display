<script>
	let {
		kind = 'Bash',
		label = '',
		status = 'done',
		output = '',
		detail = ''
	} = $props();
</script>

<details class="card" data-status={status}>
	<summary>
		<span class="kind">[{kind}]</span>
		<span class="label">{label}</span>
		<span class="st">{status}</span>
	</summary>
	{#if output || detail}
		<pre class="body">{[output, detail].filter(Boolean).join('\n')}</pre>
	{:else}
		<p class="empty">no output</p>
	{/if}
</details>

<style>
	.card {
		border-top: 1px solid var(--border);
		padding: var(--space-1) 0;
		min-width: 0;
	}
	summary {
		display: grid;
		grid-template-columns: 6.2rem minmax(0, 1fr) auto;
		gap: var(--space-2);
		align-items: baseline;
		cursor: pointer;
		list-style: none;
		min-height: 36px;
		min-width: 0;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.kind {
		font-family: var(--font-display);
		font-size: var(--type-floor);
		color: var(--scan);
	}
	.label {
		font-family: var(--font-code);
		font-size: var(--type-floor);
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.st {
		font-family: var(--font-display);
		font-size: var(--type-floor);
		color: var(--text-tertiary);
	}
	.card[data-status='working'] .st {
		color: var(--ok);
	}
	.card[data-status='error'] .st {
		color: var(--warn);
	}
	.body {
		margin: 0;
		padding: var(--space-1) 0 var(--space-2);
		font-family: var(--font-code);
		font-size: var(--type-floor);
		line-height: 1.45;
		color: var(--text-secondary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.empty {
		margin: 0 0 var(--space-1);
		font-size: var(--type-floor);
		color: var(--text-tertiary);
	}

	@media (max-width: 414px) {
		summary {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.kind {
			grid-column: 1 / -1;
		}
	}
</style>
