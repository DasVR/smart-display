<script>
	import { onMount } from 'svelte';

	let { data = null } = $props();

	let canvas = $state(null);
	let ctx = $state(null);
	let width = $state(0);
	let height = $state(0);
	let frames = $state([]);
	let frameIndex = $state(0);
	let loading = $state(true);
	let error = $state(null);
	let raf = $state(0);
	let tileCache = $state(new Map());
	let dpr = $state(1);

	const TILE_SIZE = 256;
	const ZOOM = 7;
	const RADIUS = 170;

	function projectMercator(lat, lon) {
		const siny = Math.sin((lat * Math.PI) / 180);
		return {
			x: 128 + (lon / 180) * 128,
			y: 128 - (Math.log((1 + siny) / (1 - siny)) / (2 * Math.PI)) * 128
		};
	}

	function worldToPixel(lat, lon, centerWorld, centerPixel) {
		const p = projectMercator(lat, lon);
		const scale = Math.pow(2, ZOOM) * TILE_SIZE / 256;
		return {
			x: centerPixel.x + (p.x - centerWorld.x) * scale,
			y: centerPixel.y + (p.y - centerWorld.y) * scale
		};
	}

	async function loadTile(url) {
		if (tileCache.has(url)) return tileCache.get(url);
		try {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			await new Promise((resolve, reject) => {
				img.onload = resolve;
				img.onerror = reject;
				img.src = url;
			});
			tileCache.set(url, img);
			return img;
		} catch {
			return null;
		}
	}

	function drawFrame() {
		if (!ctx || !canvas || !frames.length || !data?.rad?.host) return;
		const frame = frames[frameIndex];
		const host = data.rad.host;
		const centerWorld = projectMercator(data.rad.lat, data.rad.lon);
		const centerPixel = { x: width * 0.45, y: height / 2 };

		ctx.save();
		ctx.clearRect(0, 0, width, height);

		// Background
		ctx.fillStyle = 'rgba(5,5,7,0.95)';
		ctx.fillRect(0, 0, width, height);

		// Clip to circle
		ctx.beginPath();
		ctx.arc(centerPixel.x, centerPixel.y, RADIUS, 0, Math.PI * 2);
		ctx.clip();

		// Determine needed tile indices
		const scale = Math.pow(2, ZOOM) * TILE_SIZE / 256;
		const tilePromises = [];
		const tileList = [];
		const n = Math.pow(2, ZOOM);

		// approximate lat/lon bounds of circle
		const kmPerDegLat = 111;
		const kmPerDegLon = 111 * Math.cos((data.rad.lat * Math.PI) / 180);
		const deltaLat = (RADIUS / scale) * (256 / TILE_SIZE) * (180 / (Math.PI * 128)) / kmPerDegLat * 150;
		const deltaLon = (RADIUS / scale) * (256 / TILE_SIZE) * (180 / (Math.PI * 128)) / kmPerDegLon * 150;

		const minLat = data.rad.lat - deltaLat;
		const maxLat = data.rad.lat + deltaLat;
		const minLon = data.rad.lon - deltaLon;
		const maxLon = data.rad.lon + deltaLon;

		const nw = worldToPixel(maxLat, minLon, centerWorld, centerPixel);
		const se = worldToPixel(minLat, maxLon, centerWorld, centerPixel);

		const startTileX = Math.floor(nw.x / TILE_SIZE);
		const endTileX = Math.ceil(se.x / TILE_SIZE);
		const startTileY = Math.floor(nw.y / TILE_SIZE);
		const endTileY = Math.ceil(se.y / TILE_SIZE);

		for (let ty = startTileY; ty <= endTileY; ty++) {
			for (let tx = startTileX; tx <= endTileX; tx++) {
				const wrappedX = ((tx % n) + n) % n;
				const wrappedY = Math.max(0, Math.min(n - 1, ty));
				const url = `${host}${frame.urlTemplate}/${TILE_SIZE}/${ZOOM}/${wrappedX}/${wrappedY}/2/1_1.png`;
				const tilePixel = { x: tx * TILE_SIZE, y: ty * TILE_SIZE };
				tileList.push({ url, x: tilePixel.x, y: tilePixel.y });
				tilePromises.push(loadTile(url));
			}
		}

		Promise.all(tilePromises).then((imgs) => {
			for (let i = 0; i < imgs.length; i++) {
				const img = imgs[i];
				if (!img) continue;
				const t = tileList[i];
				ctx.globalAlpha = 0.9;
				ctx.drawImage(img, t.x, t.y, TILE_SIZE, TILE_SIZE);
			}

			// Restore before applying dither mask
			ctx.restore();

			applyDither(ctx, width, height, centerPixel.x, centerPixel.y, RADIUS);

			// ring
			ctx.beginPath();
			ctx.arc(centerPixel.x, centerPixel.y, RADIUS, 0, Math.PI * 2);
			ctx.strokeStyle = 'rgba(255,255,255,0.12)';
			ctx.lineWidth = 1.5;
			ctx.stroke();

			// center dot
			ctx.beginPath();
			ctx.arc(centerPixel.x, centerPixel.y, 3, 0, Math.PI * 2);
			ctx.fillStyle = '#fe6f69';
			ctx.fill();
		});
	}

	function applyDither(c, w, h, cx, cy, r) {
		const bayer = [
			[0, 8, 2, 10],
			[12, 4, 14, 6],
			[3, 11, 1, 9],
			[15, 7, 13, 5]
		];
		const imgData = c.getImageData(0, 0, w, h);
		const data = imgData.data;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const dx = x - cx;
				const dy = y - cy;
				if (dx * dx + dy * dy > r * r) continue;
				const i = (y * w + x) * 4;
				const threshold = ((bayer[y % 4][x % 4] + 0.5) / 16) * 255;
				const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
				const alpha = data[i + 3] / 255;
				if (alpha < 0.05) continue;
				const quant = luma < threshold ? 28 : 210;
				const mix = 0.6;
				data[i] = data[i] * (1 - mix) + quant * mix;
				data[i + 1] = data[i + 1] * (1 - mix) + quant * mix;
				data[i + 2] = data[i + 2] * (1 - mix) + quant * mix;
			}
		}
		c.putImageData(imgData, 0, 0);
	}

	function resize() {
		if (!canvas || !canvas.parentElement) return;
		const rect = canvas.parentElement.getBoundingClientRect();
		dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		width = Math.floor(rect.width);
		height = Math.floor(rect.height);
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		ctx = canvas.getContext('2d');
		ctx.scale(dpr, dpr);
		drawFrame();
	}

	function startAnimation() {
		if (!frames.length || typeof window === 'undefined') return;
		let last = performance.now();
		function loop(t) {
			if (t - last > 700) {
				frameIndex = (frameIndex + 1) % frames.length;
				drawFrame();
				last = t;
			}
			raf = requestAnimationFrame(loop);
		}
		raf = requestAnimationFrame(loop);
	}

	$effect(() => {
		if (data?.rad?.frames?.length) {
			frames = data.rad.frames;
			loading = false;
			error = null;
			frameIndex = 0;
			// wait for next paint so canvas size is settled
			requestAnimationFrame(() => drawFrame());
		}
	});

	onMount(() => {
		resize();
		window.addEventListener('resize', resize);
		startAnimation();
		return () => {
			window.removeEventListener('resize', resize);
			if (raf) cancelAnimationFrame(raf);
		};
	});
</script>

<div class="radar">
	<canvas bind:this={canvas} class="map" aria-label="dithered weather radar"></canvas>
	{#if loading}
		<div class="overlay">Loading radar...</div>
	{:else if error}
		<div class="overlay warn">{error}</div>
	{/if}
	{#if frames.length > 0}
		<div class="legend" aria-hidden="true">
			<span class:future={frames[frameIndex]?.nowcast}>{frames[frameIndex]?.nowcast ? 'NOWCAST' : 'RADAR'}</span>
		</div>
	{/if}
</div>

<style>
	.radar {
		position: relative;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border-radius: var(--radius-bezel-inner);
		background: var(--abyss);
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}
	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--text-secondary);
		background: color-mix(in srgb, var(--abyss) 70%, transparent);
	}
	.overlay.warn {
		color: var(--warn);
	}
	.legend {
		position: absolute;
		bottom: var(--space-3);
		left: var(--space-3);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--shell-fill);
		border: 1px solid var(--hairline);
		font-family: var(--font-display);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		pointer-events: none;
	}
	.legend span.future {
		color: var(--brand);
	}
</style>
