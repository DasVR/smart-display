<script>
	import { onMount, untrack } from 'svelte';
	import {
		LARGO_LAT,
		LARGO_LON,
		TILE_SIZE,
		RADAR_ZOOM,
		lonLatToFractionalTile,
		radarTileUrl,
		basemapTileUrl,
		tilesCoveringRadius,
		lastPastFrameIndex
	} from '$lib/radarMap.js';

	let { data = null } = $props();

	let canvas = $state(null);
	let ditherUrl = $state('');
	let width = $state(0);
	let height = $state(0);
	let cx = $state(0);
	let cy = $state(0);
	let radius = $state(170);
	let frames = $state([]);
	let frameIndex = $state(0);
	let loading = $state(true);
	let error = $state(null);
	let reducedMotion = $state(false);

	let ctx = null;
	let dpr = 1;
	let animTimer = 0;
	let gen = 0;
	let composed = null;
	const tileCache = new Map();

	const FRAME_MS = 700;
	const BAYER_4X4 = [
		[0, 8, 2, 10],
		[12, 4, 14, 6],
		[3, 11, 1, 9],
		[15, 7, 13, 5]
	];

	function makeBayerDataUrl() {
		const c = document.createElement('canvas');
		c.width = 4;
		c.height = 4;
		const c2 = c.getContext('2d');
		const img = c2.createImageData(4, 4);
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) {
				const v = Math.round(((BAYER_4X4[y][x] + 0.5) / 16) * 255);
				const i = (y * 4 + x) * 4;
				img.data[i] = v;
				img.data[i + 1] = v;
				img.data[i + 2] = v;
				img.data[i + 3] = 255;
			}
		}
		c2.putImageData(img, 0, 0);
		return c.toDataURL('image/png');
	}

	function loadTile(url) {
		if (tileCache.has(url)) return tileCache.get(url);
		const p = new Promise((resolve) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = () => resolve(null);
			img.src = url;
		});
		tileCache.set(url, p);
		return p;
	}

	function layoutForSize(w, h) {
		const nextRadius = Math.max(120, Math.min(w, h) * 0.42);
		return {
			cx: w * 0.5,
			cy: h * 0.5,
			radius: nextRadius
		};
	}

	function stopAnim() {
		if (animTimer) {
			clearInterval(animTimer);
			animTimer = 0;
		}
	}

	function startAnim() {
		stopAnim();
		if (reducedMotion || frames.length < 2) return;
		animTimer = setInterval(() => {
			frameIndex = (frameIndex + 1) % frames.length;
			drawCurrent();
		}, FRAME_MS);
	}

	function drawCurrent() {
		if (!ctx || !canvas || !composed) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.clip();
		const frameCanvas = composed.cache[frameIndex];
		if (frameCanvas) {
			const originX = cx + (composed.x0 - composed.fracX) * TILE_SIZE;
			const originY = cy + (composed.y0 - composed.fracY) * TILE_SIZE;
			ctx.drawImage(frameCanvas, originX, originY);
		}
		ctx.restore();
	}

	async function rebuild() {
		const rad = data?.rad;
		const nextFrames = rad?.frames ?? [];
		const host = rad?.host ?? '';
		const lat = Number.isFinite(rad?.lat) ? rad.lat : LARGO_LAT;
		const lon = Number.isFinite(rad?.lon) ? rad.lon : LARGO_LON;

		frames = nextFrames;
		if (!host || !nextFrames.length) {
			composed = null;
			loading = !nextFrames.length;
			error = host ? null : 'Radar host unavailable';
			stopAnim();
			drawCurrent();
			return;
		}

		if (!width || !height) return;

		const my = ++gen;
		const lay = layoutForSize(width, height);
		cx = lay.cx;
		cy = lay.cy;
		radius = lay.radius;

		const { x: fracX, y: fracY } = lonLatToFractionalTile(lat, lon, RADAR_ZOOM);
		const coverage = tilesCoveringRadius(fracX, fracY, lay.radius, RADAR_ZOOM);
		const { tiles, x0, x1, y0, y1 } = coverage;

		loading = true;
		error = null;

		const urls = [];
		for (const t of tiles) {
			urls.push(basemapTileUrl(RADAR_ZOOM, t.wrappedX, t.wrappedY));
			for (const frame of nextFrames) {
				urls.push(radarTileUrl(host, frame.urlTemplate, RADAR_ZOOM, t.wrappedX, t.wrappedY));
			}
		}
		await Promise.all(urls.map(loadTile));
		if (my !== gen) return;

		const cols = x1 - x0 + 1;
		const rows = y1 - y0 + 1;
		const cache = [];
		for (const frame of nextFrames) {
			const off = document.createElement('canvas');
			off.width = cols * TILE_SIZE;
			off.height = rows * TILE_SIZE;
			const octx = off.getContext('2d', { alpha: true });
			for (const t of tiles) {
				const dx = (t.tx - x0) * TILE_SIZE;
				const dy = (t.ty - y0) * TILE_SIZE;
				const base = await loadTile(basemapTileUrl(RADAR_ZOOM, t.wrappedX, t.wrappedY));
				if (base) octx.drawImage(base, dx, dy, TILE_SIZE, TILE_SIZE);
			}
			octx.globalAlpha = 0.9;
			for (const t of tiles) {
				const dx = (t.tx - x0) * TILE_SIZE;
				const dy = (t.ty - y0) * TILE_SIZE;
				const radar = await loadTile(
					radarTileUrl(host, frame.urlTemplate, RADAR_ZOOM, t.wrappedX, t.wrappedY)
				);
				if (radar) octx.drawImage(radar, dx, dy, TILE_SIZE, TILE_SIZE);
			}
			octx.globalAlpha = 1;
			cache.push(off);
		}
		if (my !== gen) return;

		composed = { cache, x0, y0, x1, y1, fracX, fracY };
		const start = lastPastFrameIndex(nextFrames);
		frameIndex = start;
		loading = false;
		error = null;
		drawCurrent();
		startAnim();
	}

	function resize() {
		if (!canvas || !canvas.parentElement) return;
		const rect = canvas.parentElement.getBoundingClientRect();
		const nextW = Math.floor(rect.width);
		const nextH = Math.floor(rect.height);
		if (nextW <= 0 || nextH <= 0) return;
		dpr = Math.min(window.devicePixelRatio || 1, 1.25);
		width = nextW;
		height = nextH;
		canvas.width = Math.floor(nextW * dpr);
		canvas.height = Math.floor(nextH * dpr);
		canvas.style.width = `${nextW}px`;
		canvas.style.height = `${nextH}px`;
		ctx = canvas.getContext('2d', { alpha: true });
		const lay = layoutForSize(nextW, nextH);
		cx = lay.cx;
		cy = lay.cy;
		radius = lay.radius;
		const rad = data?.rad;
		const lat = Number.isFinite(rad?.lat) ? rad.lat : LARGO_LAT;
		const lon = Number.isFinite(rad?.lon) ? rad.lon : LARGO_LON;
		const { x: fracX, y: fracY } = lonLatToFractionalTile(lat, lon, RADAR_ZOOM);
		const cov = tilesCoveringRadius(fracX, fracY, lay.radius, RADAR_ZOOM);
		const coverageChanged =
			!composed ||
			composed.x0 !== cov.x0 ||
			composed.y0 !== cov.y0 ||
			composed.x1 !== cov.x1 ||
			composed.y1 !== cov.y1;
		if (coverageChanged) void rebuild();
		else drawCurrent();
	}

	$effect(() => {
		const rad = data?.rad;
		const key = [
			rad?.host ?? '',
			rad?.lat ?? '',
			rad?.lon ?? '',
			(rad?.frames ?? []).map((f) => `${f.ts}:${f.urlTemplate}`).join('|')
		].join('~');
		void key;
		untrack(() => {
			void rebuild();
		});
		return () => {
			gen += 1;
			stopAnim();
		};
	});

	onMount(() => {
		ditherUrl = makeBayerDataUrl();
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		const onMotion = () => {
			reducedMotion = mq.matches;
			if (composed) {
				if (reducedMotion) {
					stopAnim();
					frameIndex = lastPastFrameIndex(frames);
					drawCurrent();
				} else {
					startAnim();
				}
			}
		};
		onMotion();
		mq.addEventListener('change', onMotion);
		resize();
		const ro = new ResizeObserver(() => resize());
		if (canvas?.parentElement) ro.observe(canvas.parentElement);
		window.addEventListener('resize', resize);
		return () => {
			mq.removeEventListener('change', onMotion);
			ro.disconnect();
			window.removeEventListener('resize', resize);
			stopAnim();
			gen += 1;
		};
	});
</script>

<div
	class="radar"
	style="--cx: {cx}px; --cy: {cy}px; --r: {radius}px"
>
	<canvas bind:this={canvas} class="map" aria-label="Weather radar centered on Largo, Florida"></canvas>
	{#if ditherUrl && !loading}
		<div class="dither" style="background-image: url({ditherUrl})" aria-hidden="true"></div>
	{/if}
	<svg class="rings" aria-hidden="true">
		<circle class="ring" cx={cx} cy={cy} r={radius} />
		<circle class="ring" cx={cx} cy={cy} r={radius * (2 / 3)} />
		<circle class="ring" cx={cx} cy={cy} r={radius / 3} />
		<circle class="mark" cx={cx} cy={cy} r="3.5" />
	</svg>
	{#if loading}
		<div class="overlay">Loading radar...</div>
	{:else if error}
		<div class="overlay warn">{error}</div>
	{/if}
	{#if frames.length > 0 && !loading}
		<div class="legend" aria-hidden="true">
			<span class:future={frames[frameIndex]?.nowcast}
				>{frames[frameIndex]?.nowcast ? 'NOWCAST' : 'RADAR'}</span
			>
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
		isolation: isolate;
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}
	.dither {
		position: absolute;
		inset: 0;
		pointer-events: none;
		clip-path: circle(var(--r) at var(--cx) var(--cy));
		background-repeat: repeat;
		background-size: 8px 8px;
		image-rendering: pixelated;
		mix-blend-mode: overlay;
		opacity: 0.32;
	}
	.rings {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}
	.ring {
		fill: none;
		stroke: color-mix(in srgb, var(--foreground) 12%, transparent);
		stroke-width: 1.5;
	}
	.mark {
		fill: var(--radar-marker);
		stroke: none;
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
	@media (prefers-reduced-motion: reduce) {
		.dither {
			opacity: 0.18;
		}
	}
</style>
