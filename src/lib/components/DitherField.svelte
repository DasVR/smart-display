<script>
	import { onMount } from 'svelte';

	let { active = false, paused = false } = $props();

	const SPECKS = Array.from({ length: 40 }, (_, i) => ({
		i,
		x: `${4 + ((i * 37) % 92)}%`,
		y: `${6 + ((i * 19) % 88)}%`,
		s: `${0.18 + (i % 5) * 0.08}rem`
	}));

	let ditherUrl = $state('');

	onMount(() => {
		const bayer = [
			[0, 8, 2, 10],
			[12, 4, 14, 6],
			[3, 11, 1, 9],
			[15, 7, 13, 5]
		];
		const c = document.createElement('canvas');
		c.width = 4;
		c.height = 4;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const img = ctx.createImageData(4, 4);
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) {
				const v = Math.round(((bayer[y][x] + 0.5) / 16) * 255);
				const i = (y * 4 + x) * 4;
				img.data[i] = v;
				img.data[i + 1] = v;
				img.data[i + 2] = v;
				img.data[i + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		ditherUrl = c.toDataURL('image/png');
	});
</script>

<div class="field" class:active class:paused aria-hidden="true">
	{#if ditherUrl}
		<div class="bayer" style="background-image: url({ditherUrl})"></div>
	{/if}
	{#each SPECKS as s (s.i)}
		<span
			class="speck"
			style="--i: {s.i}; left: {s.x}; top: {s.y}; width: {s.s}; height: {s.s}"
		></span>
	{/each}
</div>

<style>
	.field {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		z-index: 0;
		--speck: color-mix(in srgb, var(--brand) 28%, transparent);
		opacity: 0.42;
		-webkit-mask-image: radial-gradient(ellipse 88% 78% at 36% 28%, #000 18%, #000 46%, transparent 78%);
		mask-image: radial-gradient(ellipse 88% 78% at 36% 28%, #000 18%, #000 46%, transparent 78%);
	}
	.field.active {
		--speck: color-mix(in srgb, var(--ok) 55%, transparent);
		opacity: 0.85;
	}
	.bayer {
		position: absolute;
		inset: -8%;
		background-repeat: repeat;
		background-size: 6px 6px;
		opacity: 0.22;
		mix-blend-mode: overlay;
		filter: contrast(1.35);
	}
	.field.active .bayer {
		opacity: 0.38;
		animation: grain-drift 9s var(--spring-smooth) infinite alternate;
	}
	.speck {
		position: absolute;
		border-radius: 1px;
		background: var(--speck);
		opacity: 0.18;
	}
	@media (prefers-reduced-motion: no-preference) {
		.field.active:not(.paused) .speck {
			animation: think 2.4s var(--spring-smooth) infinite;
			animation-delay: calc(var(--i) * 70ms);
		}
	}
	.field.paused .speck,
	.field:not(.active) .speck {
		animation: none;
	}
	@keyframes think {
		0%,
		100% {
			opacity: 0.08;
			transform: translate(0, 0);
		}
		40% {
			opacity: 0.7;
			transform: translate(3px, -2px);
		}
		70% {
			opacity: 0.22;
			transform: translate(-2px, 3px);
		}
	}
	@keyframes grain-drift {
		from {
			transform: translate(0, 0);
		}
		to {
			transform: translate(-8px, 6px);
		}
	}
</style>
