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
		transition: opacity 280ms var(--spring-smooth);
	}
	.island-wrap.visible { opacity: 1; }

	.island {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-6);
		margin-top: var(--space-2);
		border-radius: 999px;
		background: var(--glass-fill);
		backdrop-filter: blur(var(--glass-blur)) saturate(1.5);
		-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.5);
		border: 1px solid var(--glass-edge);
		box-shadow: var(--elevation-3);
		filter: url(#gooey);
		transform: translateY(-120%);
		transition: transform 600ms var(--spring-smooth);
	}
	.island-wrap.visible .island {
		transform: translateY(0);
	}

	.island-dot {
		width: 10px; height: 10px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 60%, transparent);
		flex-shrink: 0;
	}
	.island.music .island-dot {
		background: var(--ok);
		box-shadow: 0 0 12px color-mix(in srgb, var(--ok) 60%, transparent);
	}
	.island.alert .island-dot {
		background: var(--warn);
		box-shadow: 0 0 12px color-mix(in srgb, var(--warn) 60%, transparent);
	}

	.island-title {
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--foreground);
		white-space: nowrap;
	}
	.island-body {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: nowrap;
	}
</style>
