<!--
	A level as ordered dither: a bar of whole pixels, lit by a 4 × 4 Bayer
	matrix against a soft edge, so a change dissolves in pixel by pixel instead
	of sliding (the wall's dither language, as in DitherField).

	`value` 0 to 100. `vertical` fills from the bottom (the vitals rail),
	otherwise from the left (a lane's progress). The tween only runs while the
	value is moving and stops once it settles; with reduced motion it jumps.
	`tone` picks the colour token: ok, warn, brand, scan.
-->
<script>
	import { onMount } from 'svelte';
	import { ditherLit, meterTone } from '$lib/ditherMeter.js';

	let { value = 0, vertical = false, tone = 'auto', cell = 4, label = '' } = $props();

	let canvas = $state(null);
	let box = $state(null);
	let shown = 0;
	let raf = 0;
	let size = { w: 0, h: 0, dpr: 1 };
	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	function colorOf(t) {
		const name = { ok: '--ok', warn: '--warn', brand: '--brand', scan: '--scan' }[t] || '--brand';
		return getComputedStyle(canvas).getPropertyValue(name).trim() || '#a9b1f0';
	}

	function paint() {
		if (!canvas || !size.w) return;
		const ctx = canvas.getContext('2d');
		const px = Math.max(1, Math.round(cell * size.dpr));
		const cols = Math.ceil(canvas.width / px);
		const rows = Math.ceil(canvas.height / px);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		// the empty track: a faint dot every other cell, so the bar's extent reads
		ctx.fillStyle = 'rgba(242, 242, 246, 0.07)';
		for (let y = 0; y < rows; y++) for (let x = (y % 2); x < cols; x += 2) ctx.fillRect(x * px, y * px, px - 1, px - 1);
		ctx.fillStyle = colorOf(meterTone(tone, value));
		const along = vertical ? rows : cols;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				// position along the bar, 0 at the start (bottom or left) to 1 at the end
				const pos = vertical ? (rows - 1 - y + 0.5) / along : (x + 0.5) / along;
				if (ditherLit(x, y, pos, shown / 100, 6 / along)) ctx.fillRect(x * px, y * px, px, px);
			}
		}
	}

	function fit() {
		if (!canvas || !box) return;
		const r = box.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		size = { w: r.width, h: r.height, dpr };
		canvas.width = Math.max(1, Math.round(r.width * dpr));
		canvas.height = Math.max(1, Math.round(r.height * dpr));
		paint();
	}

	function step() {
		const target = Math.max(0, Math.min(100, Number(value) || 0));
		const d = target - shown;
		if (reduce || Math.abs(d) < 0.25) {
			shown = target;
			paint();
			raf = 0;
			return;
		}
		// eases out: a quick start that settles, about 600 ms for a big change
		shown += d * 0.12;
		paint();
		raf = requestAnimationFrame(step);
	}

	$effect(() => {
		value;
		tone;
		if (!raf && canvas) raf = requestAnimationFrame(step);
	});

	onMount(() => {
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(box);
		return () => {
			ro.disconnect();
			cancelAnimationFrame(raf);
		};
	});
</script>

<div bind:this={box} class="meter" class:vertical role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(value)} aria-label={label}>
	<canvas bind:this={canvas}></canvas>
</div>

<style>
	.meter {
		position: relative;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}
</style>
