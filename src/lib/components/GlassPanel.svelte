<script>
	export let title = '';
	export let meta = '';
	export let accent = false;
</script>

<div class="glass-panel paper" class:accent data-glass>
	<span class="c tl" aria-hidden="true">┌</span>
	<span class="c tr" aria-hidden="true">┐</span>
	<span class="c bl" aria-hidden="true">└</span>
	<span class="c br" aria-hidden="true">┘</span>
	{#if title}
		<div class="glass-head">
			<span class="glass-title">// {title}</span>
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
		padding: var(--space-8);
		overflow: hidden;
		z-index: 10;
	}
	.glass-panel.accent {
		border-color: var(--brand-border);
	}
	.c {
		position: absolute;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		line-height: 1;
		color: var(--text-tertiary);
		z-index: 2;
	}
	.tl { top: 0.25rem; left: 0.5rem; }
	.tr { top: 0.25rem; right: 0.5rem; }
	.bl { bottom: 0.25rem; left: 0.5rem; }
	.br { bottom: 0.25rem; right: 0.5rem; }
	.glass-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: var(--space-3);
		gap: var(--space-3);
	}
	.glass-title {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		font-style: normal;
		color: var(--text-secondary);
	}
	.glass-meta {
		font-family: var(--font-display);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.glass-body {
		position: relative;
		z-index: 1;
	}
</style>
