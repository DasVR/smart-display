<script>
	// GooeyNotification - Layer 3: Dynamic Island blob
	// SVG feGaussianBlur + feColorMatrix metaball filter (pure SVG, ~0 GPU)
	// Blobs out from the top bezel like a drop of heavy water.
	import { onMount } from 'svelte';

	export let title = '';
	export let body = '';
	export let kind = 'info'; // info | music | alert
	export let visible = false;

	let mounted = false;
	onMount(() => { mounted = true; });
</script>

<!-- SVG metaball filter def (shared, hidden) -->
<svg width="0" height="0" style="position:absolute">
	<defs>
		<filter id="gooey">
			<feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
			<feColorMatrix in="blur" mode="matrix"
				values="1 0 0 0 0
						0 1 0 0 0
						0 0 1 0 0
						0 0 0 22 -11"
				result="goo" />
			<feBlend in="SourceGraphic" in2="goo" />
		</filter>
	</defs>
</svg>

<div class="island-wrap" class:visible class:mounted>
	<div class="island" class:music={kind === 'music'} class:alert={kind === 'alert'}>
		<div class="island-dot"></div>
		<div class="island-text">
			<div class="island-title">{title}</div>
			{#if body}<div class="island-body">{body}</div>{/if}
		</div>
	</div>
</div>

<style>
	.island-wrap {
		position: fixed;
		top: 0; left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.3s ease;
	}
	.island-wrap.visible { opacity: 1; }

	/* the gooey blob: filter applied to the pill so it stretches like water */
	.island {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 20px;
		margin-top: 10px;
		border-radius: 999px;
		background: rgba(20, 20, 30, 0.75);
		backdrop-filter: blur(20px) saturate(1.5);
		-webkit-backdrop-filter: blur(20px) saturate(1.5);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		filter: url(#gooey);
		transform: translateY(-120%);
		transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.island-wrap.visible .island {
		transform: translateY(0);
	}

	.island-dot {
		width: 10px; height: 10px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 12px rgba(169, 177, 240, 0.6);
		flex-shrink: 0;
	}
	.island.music .island-dot { background: #34d399; box-shadow: 0 0 12px rgba(52, 211, 153, 0.6); }
	.island.alert .island-dot { background: #fca5a5; box-shadow: 0 0 12px rgba(252, 165, 165, 0.6); }

	.island-title {
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 600;
		color: rgba(242, 240, 247, 0.9);
		white-space: nowrap;
	}
	.island-body {
		font-size: 12px;
		color: rgba(242, 240, 247, 0.55);
		white-space: nowrap;
	}
</style>
