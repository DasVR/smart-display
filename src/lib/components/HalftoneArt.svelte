<!--
	A painting printed as a halftone: dots of ink on paper, bigger where the
	painting is darker, on a 45° screen like a newspaper photo. Drawn once to
	a canvas when the painting or the screen size changes; nothing moves, so
	it costs nothing while the wall is up.

	`accent` adds a second ink for the warm colours (poppies, a sunset),
	printed slightly off-register like a riso print. `over` draws only the
	darkest dots on a clear canvas, to lay over something (the depth look
	prints the painting's shadows across the clock). `invert` prints the
	light instead of the dark: pale dots on dark paper, a night print.
-->
<script>
	import { onMount } from 'svelte';

	let { src = '/art/almond.jpg', paper = '#EAE3D5', ink = '#1C1A17', accent = '', cell = 6, angle = 45, alt = '', over = false, overFrom = 0.5, invert = false } = $props();

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
		ctx.clearRect(0, 0, w, h);
		if (!over) {
			ctx.fillStyle = paper;
			ctx.fillRect(0, 0, w, h);
		}
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
		const at = (x, y) => {
			const cx = Math.max(0, Math.min(sw - 1, Math.round(x / cell)));
			const cy = Math.max(0, Math.min(sh - 1, Math.round(y / cell)));
			return (cy * sw + cx) * 4;
		};
		const lum = (x, y) => {
			const i = at(x, y);
			return (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
		};
		// how warm (red, orange, yellow) and how vivid, 0..1
		const warmth = (x, y) => {
			const i = at(x, y);
			const r = px[i] / 255;
			const g = px[i + 1] / 255;
			const b = px[i + 2] / 255;
			const sat = Math.max(r, g, b) - Math.min(r, g, b);
			return Math.min(1, Math.max(0, ((r - b) * 1.6 + (r - g) * 0.8) * sat * 2.6));
		};
		// walk a rotated grid that covers the screen
		const a = (angle * Math.PI) / 180;
		const ca = Math.cos(a);
		const sa = Math.sin(a);
		const reach = Math.hypot(w, h);
		const max = cell * 0.62;
		const warm = [];
		ctx.fillStyle = ink;
		ctx.beginPath();
		for (let v = -reach; v < reach; v += cell) {
			for (let u = -reach; u < reach; u += cell) {
				const x = w / 2 + u * ca - v * sa;
				const y = h / 2 + u * sa + v * ca;
				if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
				// levels: the light parts go to bare paper, the shadows to solid ink
				let dark = invert
					? Math.min(1, Math.max(0, (lum(x, y) - 0.2) / 0.72)) ** 1.9 * 0.8
					: Math.min(1, Math.max(0, (0.84 - lum(x, y)) / 0.66)) ** 1.35;
				if (accent) {
					const k = warmth(x, y);
					if (k > 0.12) warm.push(x, y, k);
					dark *= 1 - k * 0.7;
				}
				// laid over something: only the deep shadows
				if (over) dark = dark > overFrom ? (dark - overFrom) / (1 - overFrom) : 0;
				const r = max * Math.sqrt(dark);
				if (r < 0.35) continue;
				ctx.moveTo(x + r, y);
				ctx.arc(x, y, r, 0, Math.PI * 2);
			}
		}
		ctx.fill();
		if (accent && warm.length) {
			// the second ink, a hair off-register, multiplied over the first
			ctx.globalCompositeOperation = 'multiply';
			ctx.fillStyle = accent;
			ctx.beginPath();
			for (let i = 0; i < warm.length; i += 3) {
				const r = max * Math.sqrt(Math.min(1, warm[i + 2] * 1.3));
				const x = warm[i] + 1.5;
				const y = warm[i + 1] + 1;
				ctx.moveTo(x + r, y);
				ctx.arc(x, y, r, 0, Math.PI * 2);
			}
			ctx.fill();
			ctx.globalCompositeOperation = 'source-over';
		}
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
		void w, h, paper, ink, accent, cell, angle, over, overFrom, invert;
		if (loaded) draw(loaded);
	});
</script>

<canvas class="halftone" class:over bind:this={canvas} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : 'true'}></canvas>

<style>
	.halftone {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100dvh;
		z-index: 0;
		pointer-events: none;
	}
	.halftone.over {
		z-index: auto;
	}
</style>
