<script>
	let { title = '', tag = '', ok = true, children } = $props();
</script>

<div class="ascii-frame">
	<span class="c tl" aria-hidden="true">┌</span>
	<span class="c tr" aria-hidden="true">┐</span>
	<span class="c bl" aria-hidden="true">└</span>
	<span class="c br" aria-hidden="true">┘</span>
	{#if title || tag}
		<div class="head">
			{#if title}<span class="title">// {title}</span>{/if}
			{#if tag}<span class="tag" class:ok>{tag}</span>{/if}
		</div>
	{/if}
	<div class="body">
		{@render children?.()}
	</div>
</div>

<style>
	.ascii-frame {
		position: relative;
		height: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
	}
	.c {
		position: absolute;
		font-family: var(--font-display);
		font-size: 14px;
		line-height: 1;
		color: var(--text-tertiary);
		z-index: 2;
		pointer-events: none;
	}
	.tl { top: 4px; left: 8px; }
	.tr { top: 4px; right: 8px; }
	.bl { bottom: 4px; left: 8px; }
	.br { bottom: 4px; right: 8px; }
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) 0;
		min-width: 0;
		flex-shrink: 0;
	}
	.title,
	.tag {
		font-family: var(--font-display);
		font-size: 13px;
		font-style: normal;
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.tag {
		flex-shrink: 0;
		color: var(--warn);
	}
	.tag.ok {
		color: var(--ok);
	}
	.body {
		position: relative;
		z-index: 1;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
</style>
