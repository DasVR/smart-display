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
		background: rgba(20, 20, 30, 0.42);
		backdrop-filter: blur(26px) saturate(1.55);
		-webkit-backdrop-filter: blur(26px) saturate(1.55);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 20px;
		padding: 20px 22px;
		box-shadow:
			0 12px 42px rgba(0, 0, 0, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.10);
		overflow: hidden;
		z-index: 10;
	}

	/* animated dithered gradient border shimmer */
	.glass-panel::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1px;
		background: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.45),
			rgba(169, 177, 240, 0.25) 35%,
			rgba(255, 255, 255, 0.02) 50%,
			rgba(169, 177, 240, 0.25) 65%,
			rgba(255, 255, 255, 0.35)
		);
		background-size: 200% 200%;
		animation: glass-shimmer 8s ease infinite;
		-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
	}

	@keyframes glass-shimmer {
		0%, 100% { background-position: 0% 50%; }
		50% { background-position: 100% 50%; }
	}

	/* cheap chromatic aberration: split a faint RGB copy at the top edge */
	.glass-panel::after {
		content: '';
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 1px;
		background: linear-gradient(90deg,
			rgba(255, 0, 60, 0.35),
			rgba(0, 255, 200, 0.35),
			rgba(60, 0, 255, 0.35));
		opacity: 0.7;
		pointer-events: none;
	}

	.glass-panel.accent {
		border-color: rgba(169, 177, 240, 0.45);
		box-shadow:
			0 14px 48px rgba(0, 0, 0, 0.45),
			0 0 30px rgba(169, 177, 240, 0.15),
			inset 0 1px 0 rgba(255, 255, 255, 0.12);
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
