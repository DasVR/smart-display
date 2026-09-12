<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 4 · Execution 4 · Specificity 5 · Restraint 4 · Variety 4
	Full-bleed rectangular Largo radar: ESRI z11, RainViewer z7 stretched,
	Tampa Bay intro zoom, wind vane at home. Tokens only. No other views restyled.
-->
<script>
	import { onMount, untrack } from 'svelte';
	import {
		LARGO_LAT,
		LARGO_LON,
		TILE_SIZE,
		RADAR_ZOOM,
		BASE_ZOOM,
		CITY_GROUND_M,
		INTRO_GROUND_M,
		lonLatToFractionalTile,
		radarTileUrl,
		basemapTileUrl,
		tilesCoveringRect,
		lastPastFrameIndex,
		scaleForGroundRadius,
		radarDrawSize
	} from '$lib/radarMap.js';
	import { compassFromDeg, windTowardDeg } from '$lib/atmosphere.js';

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
	let settled = $state(false);
	let zoomedIn = $state(false);
	let zoomFactor = $state(1);

	let ctx = null;
	let dpr = 1;
	let animTimer = 0;
	let settleTimer = 0;
	let introKick = 0;
	let gen = 0;
	let composed = null;
	let viewScale = 1;
	let introScale = 1;
	let cityScale = 1;
	let hasIntroduced = false;
	const tileCache = new Map();

	const FRAME_MS = 700;
	const RADAR_SIZE = radarDrawSize(BASE_ZOOM);
	const BAYER_4X4 = [
		[0, 8, 2, 10],
		[12, 4, 14, 6],
		[3, 11, 1, 9],
		[15, 7, 13, 5]
	];

	let ringLabels = $derived([
		{ r: radius * (5 / 14), km: 5 },
		{ r: radius * (9 / 14), km: 9 },
		{ r: radius, km: 14 }
	]);

	let windFrom = $derived(Number(data?.current?.windDirection));
	let windSpeed = $derived(Number(data?.current?.windSpeed) || 0);
	let windToward = $derived(Number.isFinite(windFrom) ? windTowardDeg(windFrom) : 0);
	let windCompass = $derived(compassFromDeg(windFrom));
	let showWind = $derived(Number.isFinite(windFrom) && windSpeed >= 0.4);

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
		const nextHalfW = w * 0.5;
		const nextHalfH = h * 0.5;
		const shortHalf = Math.min(nextHalfW, nextHalfH);
		return {
			cx: nextHalfW,
			cy: nextHalfH,
			halfW: nextHalfW,
			halfH: nextHalfH,
			radius: shortHalf
		};
	}

	function stopAnim() {
		if (animTimer) {
			clearInterval(animTimer);
			animTimer = 0;
		}
		if (settleTimer) {
			clearTimeout(settleTimer);
			settleTimer = 0;
		}
		if (introKick) {
			cancelAnimationFrame(introKick);
			introKick = 0;
		}
	}

	function startAnim() {
		if (animTimer) {
			clearInterval(animTimer);
			animTimer = 0;
		}
		if (reducedMotion || frames.length < 2) return;
		animTimer = setInterval(() => {
			frameIndex = (frameIndex + 1) % frames.length;
			drawCurrent();
		}, FRAME_MS);
	}

	function introDurationMs() {
		if (typeof getComputedStyle === 'undefined') return 1100;
		const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-pane').trim();
		const n = parseFloat(raw);
		if (!Number.isFinite(n)) return 1100;
		return raw.endsWith('ms') || !raw.endsWith('s') ? n * 1.6 : n * 1600;
	}

	function drawCurrent() {
		if (!ctx || !canvas || !composed) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.save();
		ctx.translate(cx, cy);
		ctx.scale(viewScale, viewScale);
		const originX = (composed.x0 - composed.fracX) * TILE_SIZE;
		const originY = (composed.y0 - composed.fracY) * TILE_SIZE;
		if (composed.basemap) {
			ctx.drawImage(composed.basemap, originX, originY);
		}
		const layer = composed.radarLayers[frameIndex];
		if (layer) {
			ctx.globalAlpha = 0.9;
			const k = RADAR_SIZE / TILE_SIZE;
			for (const sprite of layer) {
				if (!sprite.img) continue;
				ctx.drawImage(
					sprite.img,
					sprite.tx * k * TILE_SIZE - composed.fracX * TILE_SIZE,
					sprite.ty * k * TILE_SIZE - composed.fracY * TILE_SIZE,
					RADAR_SIZE,
					RADAR_SIZE
				);
			}
			ctx.globalAlpha = 1;
		}
		ctx.restore();
	}

	function playIntro() {
		viewScale = introScale;
		zoomFactor = cityScale / introScale;
		drawCurrent();
		startAnim();
		if (reducedMotion) {
			zoomedIn = true;
			settled = true;
			hasIntroduced = true;
			return;
		}
		if (hasIntroduced) {
			zoomedIn = true;
			return;
		}
		zoomedIn = false;
		settled = false;
		introKick = requestAnimationFrame(() => {
			introKick = requestAnimationFrame(() => {
				introKick = 0;
				zoomedIn = true;
				hasIntroduced = true;
				settleTimer = setTimeout(() => {
					settled = true;
					settleTimer = 0;
				}, introDurationMs());
			});
		});
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
		introScale = scaleForGroundRadius(lay.radius, lat, BASE_ZOOM, INTRO_GROUND_M);
		cityScale = scaleForGroundRadius(lay.radius, lat, BASE_ZOOM, CITY_GROUND_M);

		const frac = lonLatToFractionalTile(lat, lon, BASE_ZOOM);
		const worldHalfW = lay.halfW / introScale;
		const worldHalfH = lay.halfH / introScale;
		const esri = tilesCoveringRect(frac.x, frac.y, worldHalfW, worldHalfH, BASE_ZOOM);
		const radarFrac = lonLatToFractionalTile(lat, lon, RADAR_ZOOM);
		const kZoom = 2 ** (BASE_ZOOM - RADAR_ZOOM);
		const rain = tilesCoveringRect(
			radarFrac.x,
			radarFrac.y,
			worldHalfW / kZoom,
			worldHalfH / kZoom,
			RADAR_ZOOM
		);

		loading = true;
		error = null;

		const urls = [];
		for (const t of esri.tiles) {
			urls.push(basemapTileUrl(BASE_ZOOM, t.wrappedX, t.wrappedY));
		}
		for (const t of rain.tiles) {
			for (const frame of nextFrames) {
				urls.push(radarTileUrl(host, frame.urlTemplate, RADAR_ZOOM, t.wrappedX, t.wrappedY));
			}
		}
		await Promise.all(urls.map(loadTile));
		if (my !== gen) return;

		const cols = esri.x1 - esri.x0 + 1;
		const rows = esri.y1 - esri.y0 + 1;
		const basemap = document.createElement('canvas');
		basemap.width = cols * TILE_SIZE;
		basemap.height = rows * TILE_SIZE;
		const bctx = basemap.getContext('2d', { alpha: true });
		for (const t of esri.tiles) {
			const img = await loadTile(basemapTileUrl(BASE_ZOOM, t.wrappedX, t.wrappedY));
			if (!img) continue;
			bctx.drawImage(
				img,
				(t.tx - esri.x0) * TILE_SIZE,
				(t.ty - esri.y0) * TILE_SIZE,
				TILE_SIZE,
				TILE_SIZE
			);
		}

		const radarLayers = [];
		for (const frame of nextFrames) {
			const layer = [];
			for (const t of rain.tiles) {
				const img = await loadTile(
					radarTileUrl(host, frame.urlTemplate, RADAR_ZOOM, t.wrappedX, t.wrappedY)
				);
				layer.push({ tx: t.tx, ty: t.ty, img });
			}
			radarLayers.push(layer);
		}
		if (my !== gen) return;

		composed = {
			basemap,
			radarLayers,
			x0: esri.x0,
			y0: esri.y0,
			x1: esri.x1,
			y1: esri.y1,
			fracX: frac.x,
			fracY: frac.y
		};
		frameIndex = lastPastFrameIndex(nextFrames);
		loading = false;
		error = null;
		playIntro();
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
		introScale = scaleForGroundRadius(lay.radius, lat, BASE_ZOOM, INTRO_GROUND_M);
		cityScale = scaleForGroundRadius(lay.radius, lat, BASE_ZOOM, CITY_GROUND_M);
		viewScale = introScale;
		zoomFactor = cityScale / introScale;
		const worldHalfW = lay.halfW / introScale;
		const worldHalfH = lay.halfH / introScale;
		const frac = lonLatToFractionalTile(lat, Number.isFinite(rad?.lon) ? rad.lon : LARGO_LON, BASE_ZOOM);
		const cov = tilesCoveringRect(frac.x, frac.y, worldHalfW, worldHalfH, BASE_ZOOM);
		const coverageChanged =
			!composed ||
			composed.x0 !== cov.x0 ||
			composed.y0 !== cov.y0 ||
			composed.x1 !== cov.x1 ||
			composed.y1 !== cov.y1;
		if (hasIntroduced) zoomedIn = true;
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
			if (!composed) return;
			if (reducedMotion) {
				stopAnim();
				zoomedIn = true;
				settled = true;
				hasIntroduced = true;
				frameIndex = lastPastFrameIndex(frames);
				drawCurrent();
			} else if (hasIntroduced) {
				startAnim();
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
	style="--cx: {cx}px; --cy: {cy}px; --zoom-in: {zoomFactor}"
>
	<div class="map-clip">
		<div class="map-zoom" class:city={zoomedIn}>
			<canvas bind:this={canvas} class="map" aria-label="Weather radar centered on Largo, Florida"></canvas>
		</div>
	</div>
	{#if ditherUrl && !loading}
		<div class="dither" style="background-image: url({ditherUrl})" aria-hidden="true"></div>
	{/if}
	<svg class="rings" aria-hidden="true">
		{#each ringLabels as ring (ring.km)}
			<circle class="ring" cx={cx} cy={cy} r={ring.r} />
			{#if settled}
				<text class="ring-label" text-anchor="middle" x={cx} y={cy - ring.r + 14}
					>{ring.km} km</text
				>
			{/if}
		{/each}
		{#if showWind}
			<g class="vane" transform="translate({cx} {cy}) rotate({windToward})">
				<line class="vane-shaft" x1="0" y1="10" x2="0" y2={-Math.max(36, radius * 0.28)} />
				<polygon
					class="vane-head"
					points="0,{-(Math.max(36, radius * 0.28) + 10)} -6,{-(Math.max(36, radius * 0.28) - 6)} 6,{-(Math.max(36, radius * 0.28) - 6)}"
				/>
			</g>
		{/if}
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
				>{frames[frameIndex]?.nowcast ? 'NOWCAST' : 'LARGO'}</span
			>
			{#if showWind}
				<span class="wind-read">{windCompass} {Math.round(windSpeed)} mph</span>
			{/if}
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
	.map-clip {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.map-zoom {
		position: absolute;
		inset: 0;
		transform-origin: var(--cx) var(--cy);
		transform: scale(1);
		transition: transform calc(var(--dur-pane) * 1.6) var(--ease-out);
	}
	.map-zoom.city {
		transform: scale(var(--zoom-in));
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
		background-repeat: repeat;
		background-size: 8px 8px;
		image-rendering: pixelated;
		mix-blend-mode: overlay;
		opacity: 0.28;
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
	.ring-label {
		fill: var(--text-tertiary);
		font-family: var(--font-display);
		font-size: var(--text-sm);
		font-style: normal;
	}
	.mark {
		fill: var(--radar-marker);
		stroke: none;
	}
	.vane-shaft {
		stroke: color-mix(in srgb, var(--scan) 80%, var(--foreground));
		stroke-width: 2;
		stroke-linecap: round;
	}
	.vane-head {
		fill: var(--scan);
	}
	.legend {
		position: absolute;
		bottom: var(--space-3);
		left: var(--space-3);
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
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
	.wind-read {
		color: var(--scan);
		font-style: normal;
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
	@media (prefers-reduced-motion: reduce) {
		.map-zoom {
			transition: none;
		}
		.dither {
			opacity: 0.16;
		}
	}
</style>
