<script>
	// GlassPanel - Layer 2: liquid glass container
	// CSS backdrop-filter blur + 1px edge highlight + cheap chromatic aberration
	// 0 GPU cost, pure CSS. Sits on top of the dithered fluid canvas.
	export let title = '';
	export let meta = '';
	export let accent = false;
</script>

<div class="glass-panel" class:accent>
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
		background: rgba(20, 20, 30, 0.28);
		backdrop-filter: blur(18px) saturate(1.4);
		-webkit-backdrop-filter: blur(18px) saturate(1.4);
		border: 1px solid rgba(255, 255, 255, 0.10);
		border-radius: 20px;
		padding: 20px 22px;
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}

	/* 1px edge highlight (the "thick glass" rim) */
	.glass-panel::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1px;
		background: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.22),
			rgba(255, 255, 255, 0.02) 40%,
			rgba(255, 255, 255, 0.02) 60%,
			rgba(255, 255, 255, 0.10)
		);
		-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
	}

	/* cheap chromatic aberration: split a faint RGB copy at the top edge */
	.glass-panel::after {
		content: '';
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 1px;
		background: linear-gradient(90deg,
			rgba(255, 0, 60, 0.25),
			rgba(0, 255, 200, 0.25),
			rgba(60, 0, 255, 0.25));
		opacity: 0.5;
		pointer-events: none;
	}

	.glass-panel.accent {
		border-color: rgba(169, 177, 240, 0.35);
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.35),
			0 0 24px rgba(169, 177, 240, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.10);
	}

	.glass-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.glass-title {
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: rgba(242, 240, 247, 0.75);
	}
	.glass-meta {
		font-family: var(--font-display);
		font-size: 11px;
		color: rgba(242, 240, 247, 0.35);
	}
	.glass-body {
		position: relative;
		z-index: 1;
	}
</style>
