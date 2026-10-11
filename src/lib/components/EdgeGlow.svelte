<script>
	// Siri-style light around the screen edge while the wall is listening or
	// talking. tone 'alert' is the warm, faster, breathing version for when
	// something needs you (src/lib/attention.js). Cheap by construction: the colour wheel only rotates (a
	// compositor transform, no repaint), and the soft edge is a static mask
	// rather than a blur filter. Nothing is mounted while it's idle.
	import { fade } from 'svelte/transition';

	/** @type {{ active?: boolean, still?: boolean, tone?: 'voice' | 'alert' }} */
	let { active = false, still = false, tone = 'voice' } = $props();
</script>

{#if active}
	<div class="edge-glow" class:still class:alert={tone === 'alert'} aria-hidden="true" transition:fade={{ duration: 420 }}>
		<div class="wheel"></div>
	</div>
{/if}

<style>
	.edge-glow {
		position: fixed;
		inset: 0;
		z-index: 60;
		pointer-events: none;
		overflow: hidden;
		--edge: 46px;
		/* four eased fades from the edges, added together: a soft ring */
		mask-image:
			linear-gradient(to right, #000, rgb(0 0 0 / 0.55) calc(var(--edge) * 0.3), rgb(0 0 0 / 0.15) calc(var(--edge) * 0.7), transparent var(--edge)),
			linear-gradient(to left, #000, rgb(0 0 0 / 0.55) calc(var(--edge) * 0.3), rgb(0 0 0 / 0.15) calc(var(--edge) * 0.7), transparent var(--edge)),
			linear-gradient(to bottom, #000, rgb(0 0 0 / 0.55) calc(var(--edge) * 0.3), rgb(0 0 0 / 0.15) calc(var(--edge) * 0.7), transparent var(--edge)),
			linear-gradient(to top, #000, rgb(0 0 0 / 0.55) calc(var(--edge) * 0.3), rgb(0 0 0 / 0.15) calc(var(--edge) * 0.7), transparent var(--edge));
		mask-composite: add;
		-webkit-mask-composite: source-over;
	}

	.wheel {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 160vmax;
		height: 160vmax;
		margin: -80vmax 0 0 -80vmax;
		background: conic-gradient(
			from 0deg,
			#4f8cff,
			#a35bff,
			#ff5fa8,
			#ff9b4a,
			#ffd36b,
			#5fe3ff,
			#4f8cff
		);
		opacity: 0.9;
		animation: spin 3.6s linear infinite;
		will-change: transform;
	}

	.still .wheel {
		animation: none;
	}

	/* something needs you: warm, quicker, and the whole ring breathes */
	.alert {
		--edge: 64px;
		animation: alert-breathe 1.6s ease-in-out infinite;
	}
	.alert .wheel {
		background: conic-gradient(from 0deg, #ff9b4a, #ffd36b, #ff5f5f, #ff9b4a, #ffd36b, #ff5f5f, #ff9b4a);
		animation-duration: 2.2s;
	}
	@keyframes alert-breathe {
		50% {
			opacity: 0.45;
		}
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wheel,
		.alert {
			animation: none;
		}
	}
</style>
