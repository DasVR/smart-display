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
	// Radius in pixels to composite around center
	const RADIUS = 180;
	// Offset from center to prefer right side for condition panel
	const CENTER_OFFSET_X = 60;

	function latLonToTile(lat, lon, z) {
		const n = Math.pow(2, z);
		const x = Math.floor(((lon + 180) / 360) * n);
		const latRad = (lat * Math.PI) / 180;
		const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
		return { x, y, n };
	}

	function tileToLatLon(x, y, z) {
		const n = Math.pow(2, z);
		const lon = (x / n) * 360 - 180;
		const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
		const lat = (latRad * 180) / Math.PI;
		return { lat, lon };
	}

	function project(lat, lon, centerTile, offsetX, offsetY) {
		const nw = tileToLatLon(centerTile.x, centerTile.y, ZOOM);
		const se = tileToLatLon(centerTile.x + 1, centerTile.y + 1, ZOOM);
		const x = offsetX + ((lon - nw.lon) / (se.lon - nw.lon)) * TILE_SIZE;
		const y = offsetY + ((nw.lat - lat) / (nw.lat - se.lat)) * TILE_SIZE;
		return { x, y };
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
		const center = latLonToTile(data.rad.lat, data.rad.lon, ZOOM);
		const centerPixel = project(data.rad.lat, data.rad.lon, center, width / 2 + CENTER_OFFSET_X, height / 2);

		ctx.clearRect(0, 0, width, height);

		// draw base map tiles (optional dark fill if tiles fail)
		ctx.fillStyle = 'rgba(5,5,7,0.9)';
		ctx.fillRect(0, 0, width, height);

		// Determine tile range needed for the circular viewport
		const startX = Math.floor((centerPixel.x - RADIUS) / TILE_SIZE) - 1;
		const endX = Math.ceil((centerPixel.x + RADIUS) / TILE_SIZE) + 1;
		const startY = Math.floor((centerPixel.y - RADIUS) / TILE_SIZE) - 1;
		const endY = Math.ceil((centerPixel.y + RADIUS) / TILE_SIZE) + 1;

		const promises = [];
		for (let ty = startY; ty <= endY; ty++) {
			for (let tx = startX; tx <= endX; tx++) {
				const url = `${host}${frame.urlTemplate}/256/${ZOOM}/${tx}/${ty}/2/1_1.png`;
				promises.push(
					loadTile(url).then((img) => {
						if (!img) return;
						const tilePixel = project(tileToLatLon(tx, ty, ZOOM).lat, tileToLatLon(tx, ty, ZOOM).lon, center, width / 2 + CENTER_OFFSET_X, height / 2);
						ctx.globalAlpha = 0.85;
						ctx.drawImage(img, tilePixel.x, tilePixel.y, TILE_SIZE, TILE_SIZE);
					})
				);
			}
		}

		Promise.all(promises).then(() => {
			// circular mask + dither
			const temp = document.createElement('canvas');
			temp.width = width;
			temp.height = height;
			const tctx = temp.getContext('2d');
			tctx.drawImage(canvas, 0, 0);

			ctx.globalCompositeOperation = 'destination-in';
			ctx.beginPath();
			ctx.arc(centerPixel.x, centerPixel.y, RADIUS, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalCompositeOperation = 'source-over';

			applyDither(ctx, width, height, centerPixel.x, centerPixel.y, RADIUS);

			// border ring
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
		for (let y = 0; y < h; y += 1) {
			for (let x = 0; x < w; x += 1) {
				const dx = x - cx;
				const dy = y - cy;
				if (dx * dx + dy * dy > r * r) continue;
				const i = (y * w + x) * 4;
				const threshold = ((bayer[y % 4][x % 4] + 0.5) / 16) * 255;
				const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
				const quant = luma < threshold ? 16 : 220;
				const mix = 0.72;
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
			drawFrame();
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
