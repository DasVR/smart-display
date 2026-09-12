<script>
	import { onMount } from 'svelte';

	let { data = null } = $props();

	let canvas = $state(null);
	let ctx = $state(null);
	let width = $state(0);
	let height = $state(0);
	let radius = $state(170);
	let frames = $state([]);
	let frameIndex = $state(0);
	let loading = $state(true);
	let error = $state(null);
	let raf = $state(0);
	let tileCache = $state(new Map());
	let dpr = $state(1);

	// RainViewer serves the same map area at 256px OR 512px per tile - 512
	// is a straight sharper asset for the identical geographic cell, so it's
	// a real resolution win, not just upscaling.
	const TILE_SIZE = 512;
	const DEFAULT_ZOOM = 7;
	const MIN_ZOOM = 5; // wide enough to catch a Gulf-scale system approaching
	const MAX_ZOOM = 9; // tight, high-definition local view when it's clear
	const RADIUS_INSET = 10;

	// The circle grows/shrinks to actually fill the (now padded) container
	// instead of a fixed 170px regardless of how much room there is.
	let zoomLevel = $state(DEFAULT_ZOOM);

	// Adaptive zoom bookkeeping: only reassessed every few seconds, and only
	// acted on after the same direction shows up twice in a row, so the view
	// doesn't flicker between zoom levels as precip drifts near the edge.
	let lastZoomAssessAt = 0;
	let pendingZoomDirection = 0;
	let pendingZoomStreak = 0;
	const ZOOM_ASSESS_INTERVAL_MS = 9000;
	const ZOOM_STREAK_NEEDED = 2;
	const EDGE_COVERAGE_ZOOM_OUT = 0.1;
	const TOTAL_COVERAGE_ZOOM_IN = 0.015;
	let analysisCanvas;

	let theme = { bg: 'rgba(5,5,7,0.95)', ring: 'rgba(255,255,255,0.12)', marker: '#fe6f69' };

	/** Resolves any CSS color (custom property, color-mix, etc.) to a canonical rgb()/rgba() string. */
	function resolveColor(value) {
		if (typeof document === 'undefined' || !value) return value;
		const probe = document.createElement('span');
		probe.style.display = 'none';
		probe.style.color = value;
		document.body.appendChild(probe);
		const resolved = getComputedStyle(probe).color;
		document.body.removeChild(probe);
		return resolved;
	}

	function withAlpha(rgb, alpha) {
		const m = rgb.match(/\d+(\.\d+)?/g);
		if (!m || m.length < 3) return rgb;
		return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
	}

	function readTheme() {
		if (typeof document === 'undefined') return;
		const cs = getComputedStyle(document.documentElement);
		const abyss = cs.getPropertyValue('--abyss').trim() || '#07070b';
		const foreground = cs.getPropertyValue('--foreground').trim() || '#f2f2f6';
		const marker = cs.getPropertyValue('--radar-marker').trim() || '#fe6f69';
		theme = {
			bg: withAlpha(resolveColor(abyss), 0.95),
			ring: withAlpha(resolveColor(foreground), 0.12),
			marker: resolveColor(marker)
		};
	}

	function projectMercator(lat, lon) {
		const siny = Math.sin((lat * Math.PI) / 180);
		return {
			x: 128 + (lon / 180) * 128,
			y: 128 - (Math.log((1 + siny) / (1 - siny)) / (2 * Math.PI)) * 128
		};
	}

	function worldToPixel(lat, lon, centerWorld, centerPixel, scale) {
		const p = projectMercator(lat, lon);
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

	/** Which tiles cover the visible circle at the given zoom/scale, in the
	 *  same CSS-pixel coordinate space the canvas is drawn in. */
	function tilesForView(host, urlTemplate, lat, lon, centerPixel, radius, zoom) {
		const centerWorld = projectMercator(lat, lon);
		const scale = (Math.pow(2, zoom) * TILE_SIZE) / 256;
		const n = Math.pow(2, zoom);

		const kmPerDegLat = 111;
		const kmPerDegLon = 111 * Math.cos((lat * Math.PI) / 180);
		const deltaLat = (((radius / scale) * (256 / TILE_SIZE) * (180 / (Math.PI * 128))) / kmPerDegLat) * 150;
		const deltaLon = (((radius / scale) * (256 / TILE_SIZE) * (180 / (Math.PI * 128))) / kmPerDegLon) * 150;

		const nw = worldToPixel(lat + deltaLat, lon - deltaLon, centerWorld, centerPixel, scale);
		const se = worldToPixel(lat - deltaLat, lon + deltaLon, centerWorld, centerPixel, scale);

		const startTileX = Math.floor(nw.x / TILE_SIZE);
		const endTileX = Math.ceil(se.x / TILE_SIZE);
		const startTileY = Math.floor(nw.y / TILE_SIZE);
		const endTileY = Math.ceil(se.y / TILE_SIZE);

		const tiles = [];
		for (let ty = startTileY; ty <= endTileY; ty++) {
			for (let tx = startTileX; tx <= endTileX; tx++) {
				const wrappedX = ((tx % n) + n) % n;
				const wrappedY = Math.max(0, Math.min(n - 1, ty));
				const url = `${host}${urlTemplate}/${TILE_SIZE}/${zoom}/${wrappedX}/${wrappedY}/2/1_1.png`;
				tiles.push({ url, x: tx * TILE_SIZE, y: ty * TILE_SIZE });
			}
		}
		return { tiles, scale };
	}

	/** Average alpha coverage of actual precipitation pixels (RainViewer
	 *  tiles are transparent where there's nothing to show), both across the
	 *  whole visible circle and just its outer edge — a system with strong
	 *  coverage right at the edge is very likely bigger than what's in view. */
	function assessPrecipCoverage(imgData, w, h, cx, cy, r) {
		const data = imgData.data;
		const edgeR2 = (r * 0.72) ** 2;
		const fullR2 = r * r;
		let edgeAlpha = 0,
			edgeCount = 0,
			totalAlpha = 0,
			totalCount = 0;
		for (let y = 0; y < h; y++) {
			const dy = y - cy;
			for (let x = 0; x < w; x++) {
				const dx = x - cx;
				const d2 = dx * dx + dy * dy;
				if (d2 > fullR2) continue;
				const a = data[(y * w + x) * 4 + 3] / 255;
				totalAlpha += a;
				totalCount++;
				if (d2 >= edgeR2) {
					edgeAlpha += a;
					edgeCount++;
				}
			}
		}
		return {
			edgeCoverage: edgeCount ? edgeAlpha / edgeCount : 0,
			totalCoverage: totalCount ? totalAlpha / totalCount : 0
		};
	}

	/** Widens or tightens the view based on where precipitation actually is,
	 *  gated to an occasional check with a same-direction streak so the zoom
	 *  doesn't hunt back and forth as a storm edge drifts across the ring. */
	function assessAndMaybeAdjustZoom(coverage) {
		const now = performance.now();
		if (now - lastZoomAssessAt < ZOOM_ASSESS_INTERVAL_MS) return false;
		lastZoomAssessAt = now;

		let direction = 0;
		if (coverage.edgeCoverage > EDGE_COVERAGE_ZOOM_OUT && zoomLevel > MIN_ZOOM) direction = -1;
		else if (coverage.totalCoverage < TOTAL_COVERAGE_ZOOM_IN && zoomLevel < MAX_ZOOM) direction = 1;

		if (direction !== 0 && direction === pendingZoomDirection) {
			pendingZoomStreak++;
		} else {
			pendingZoomDirection = direction;
			pendingZoomStreak = direction === 0 ? 0 : 1;
		}

		if (direction !== 0 && pendingZoomStreak >= ZOOM_STREAK_NEEDED) {
			zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel + direction));
			pendingZoomStreak = 0;
			pendingZoomDirection = 0;
			return true;
		}
		return false;
	}

	function drawFrame() {
		if (!ctx || !canvas || !frames.length || !data?.rad?.host) return;
		const frame = frames[frameIndex];
		const host = data.rad.host;
		const centerPixel = { x: width / 2, y: height / 2 };

		const { tiles } = tilesForView(
			host,
			frame.urlTemplate,
			data.rad.lat,
			data.rad.lon,
			centerPixel,
			radius,
			zoomLevel
		);

		Promise.all(tiles.map((t) => loadTile(t.url))).then((imgs) => {
			// Composite onto a transparent CSS-pixel-space canvas first so
			// tile alpha (i.e. "is there precip here") survives for the
			// coverage scan below - the visible canvas gets an opaque
			// background painted under it, which would otherwise erase that.
			if (!analysisCanvas) analysisCanvas = document.createElement('canvas');
			analysisCanvas.width = width;
			analysisCanvas.height = height;
			const actx = analysisCanvas.getContext('2d');
			actx.clearRect(0, 0, width, height);
			for (let i = 0; i < imgs.length; i++) {
				if (!imgs[i]) continue;
				actx.drawImage(imgs[i], tiles[i].x, tiles[i].y, TILE_SIZE, TILE_SIZE);
			}

			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = theme.bg;
			ctx.fillRect(0, 0, width, height);

			ctx.save();
			ctx.beginPath();
			ctx.arc(centerPixel.x, centerPixel.y, radius, 0, Math.PI * 2);
			ctx.clip();
			ctx.globalAlpha = 0.9;
			ctx.drawImage(analysisCanvas, 0, 0);
			ctx.restore();

			// getImageData/putImageData always address the canvas's actual
			// backing-store (physical) pixels, ignoring the dpr transform
			// active on ctx for drawing ops - so this needs physical-pixel
			// dimensions or a HiDPI display only gets a corner dithered.
			applyDither(ctx, canvas.width, canvas.height, centerPixel.x * dpr, centerPixel.y * dpr, radius * dpr);

			ctx.beginPath();
			ctx.arc(centerPixel.x, centerPixel.y, radius, 0, Math.PI * 2);
			ctx.strokeStyle = theme.ring;
			ctx.lineWidth = 1.5;
			ctx.stroke();

			ctx.beginPath();
			ctx.arc(centerPixel.x, centerPixel.y, 3, 0, Math.PI * 2);
			ctx.fillStyle = theme.marker;
			ctx.fill();

			const coverage = assessPrecipCoverage(
				actx.getImageData(0, 0, width, height),
				width,
				height,
				centerPixel.x,
				centerPixel.y,
				radius
			);
			if (assessAndMaybeAdjustZoom(coverage)) drawFrame();
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
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		width = Math.floor(rect.width);
		height = Math.floor(rect.height);
		radius = Math.max(90, Math.min(width, height) / 2 - RADIUS_INSET);
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
		readTheme();
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
			<span class="zoom-tag">Z{zoomLevel}</span>
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
		display: flex;
		align-items: center;
		gap: var(--space-2);
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
	.zoom-tag {
		opacity: 0.55;
	}
</style>
