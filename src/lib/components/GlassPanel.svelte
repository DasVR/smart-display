<script>
	export let title = '';
	export let meta = '';
	export let accent = false;
</script>

<div class="glass-panel paper" class:accent>
	{#if title}
		<div class="glass-head">
			<span class="glass-title">{title}</span>
			{#if meta}<span class="glass-meta">{meta}</span>{/if}
		</div>
	{/if}
	<div class="glass-body">
		<slot />
	</div>
</div>

<style>
	.glass-panel {
		position: relative;
		padding: var(--space-5);
		overflow: hidden;
		z-index: 10;
	}
	.glass-panel.accent {
		border-color: var(--brand-border);
	}
	.glass-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: var(--space-3);
		gap: var(--space-3);
	}
	.glass-title {
		font-size: 13px;
		font-weight: 600;
		font-style: normal;
		color: var(--text-secondary);
	}
	.glass-meta {
		font-family: var(--font-display);
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.glass-body {
		position: relative;
		z-index: 1;
	}
</style>
