<!--
	A painting printed as a halftone: dots of ink on paper, bigger where the
	painting is darker, on a 45° screen like a newspaper photo. Drawn once to
	a canvas when the painting or the screen size changes; nothing moves, so
	it costs nothing while the wall is up.
-->
<script>
	import { onMount } from 'svelte';

	let { src = '/art/almond.jpg', paper = '#EAE3D5', ink = '#1C1A17', cell = 6, angle = 45, alt = '' } = $props();

	let canvas;
	let w = $state(0);
	let h = $state(0);

	function draw(img) {
		if (!canvas || !w || !h) return;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = paper;
		ctx.fillRect(0, 0, w, h);
		// the painting, covering the screen, read at one pixel per screen cell
		const sw = Math.ceil(w / cell) + 4;
		const sh = Math.ceil(h / cell) + 4;
		const probe = document.createElement('canvas');
		probe.width = sw;
		probe.height = sh;
		const p = probe.getContext('2d', { willReadFrequently: true });
		if (!p) return;
		const s = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
		const dw = img.naturalWidth * s;
		const dh = img.naturalHeight * s;
		p.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
		const px = p.getImageData(0, 0, sw, sh).data;
		const lum = (x, y) => {
			const cx = Math.max(0, Math.min(sw - 1, Math.round(x / cell)));
			const cy = Math.max(0, Math.min(sh - 1, Math.round(y / cell)));
			const i = (cy * sw + cx) * 4;
			return (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
		};
		// walk a rotated grid that covers the screen
		const a = (angle * Math.PI) / 180;
		const ca = Math.cos(a);
		const sa = Math.sin(a);
		const reach = Math.hypot(w, h);
		const max = cell * 0.62;
		ctx.fillStyle = ink;
		ctx.beginPath();
		for (let v = -reach; v < reach; v += cell) {
			for (let u = -reach; u < reach; u += cell) {
				const x = w / 2 + u * ca - v * sa;
				const y = h / 2 + u * sa + v * ca;
				if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
				// a little contrast, so the paper shows through the light parts
				// levels: the light parts go to bare paper, the shadows to solid ink
				const dark = Math.min(1, Math.max(0, (0.84 - lum(x, y)) / 0.66)) ** 1.35;
				const r = max * Math.sqrt(dark);
				if (r < 0.35) continue;
				ctx.moveTo(x + r, y);
				ctx.arc(x, y, r, 0, Math.PI * 2);
			}
		}
		ctx.fill();
	}

	let loaded = null;
	function load(url) {
		const img = new Image();
		img.decoding = 'async';
		img.onload = () => {
			loaded = img;
			draw(img);
		};
		img.src = url;
	}

	onMount(() => {
		const fit = () => {
			w = window.innerWidth;
			h = window.innerHeight;
		};
		fit();
		window.addEventListener('resize', fit);
		return () => window.removeEventListener('resize', fit);
	});

	$effect(() => {
		if (src && w) load(src);
	});
	$effect(() => {
		// redraw on a new size or new inks without fetching again
		void w, h, paper, ink, cell, angle;
		if (loaded) draw(loaded);
	});
</script>

<canvas class="halftone" bind:this={canvas} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : 'true'}></canvas>

<style>
	.halftone {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100dvh;
		z-index: 0;
		pointer-events: none;
	}
</style>
