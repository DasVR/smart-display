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
		STORM_GROUND_M,
		lonLatToFractionalTile,
		radarTileUrl,
		basemapTileUrl,
		tilesCoveringRect,
		lastPastFrameIndex,
		scaleForGroundRadius,
		metersPerPixel,
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
	let suppressTransition = $state(false);

	let ctx = null;
	let dpr = 1;
	let animTimer = 0;
	let settleTimer = 0;
	let introKick = 0;
	let zoomAssessTimer = 0;
	let nativeSnapTimer = 0;
	let gen = 0;
	let composed = null;
	let viewScale = 1;
	let introScale = 1;
	let currentLat = LARGO_LAT;
	let hasIntroduced = false;
	const tileCache = new Map();

	// Adaptive zoom: 0 is the tight, settled city view; 1 is pulled all the
	// way out to STORM_GROUND_M. Reassessed on a slow interval and only acted
	// on after the same direction repeats, so the view doesn't hunt back and
	// forth as a storm edge drifts near the ring.
	let adaptiveT = 0;
	let adaptiveGroundM = $state(CITY_GROUND_M);
	let lastZoomAssessAt = 0;
	let pendingZoomDir = 0;
	let pendingZoomStreak = 0;
	const ZOOM_ASSESS_INTERVAL_MS = 9000;
	const ZOOM_STREAK_NEEDED = 2;
	const ZOOM_STEP = 1 / 3;
	const EDGE_COVERAGE_ZOOM_OUT = 0.1;
	const TOTAL_COVERAGE_ZOOM_IN = 0.015;

	const FRAME_MS = 700;
	const RADAR_SIZE = radarDrawSize(BASE_ZOOM);
	const BAYER_4X4 = [
		[0, 8, 2, 10],
		[12, 4, 14, 6],
		[3, 11, 1, 9],
		[15, 7, 13, 5]
	];

	// Ring screen positions stay at fixed fractions of the container; the km
	// labels track the actual current ground radius so they stay honest once
	// the adaptive zoom pulls back to show an approaching system.
	let ringLabels = $derived([
		{ r: radius * (5 / 14), km: Math.round((adaptiveGroundM * (5 / 14)) / 1000) },
		{ r: radius * (9 / 14), km: Math.round((adaptiveGroundM * (9 / 14)) / 1000) },
		{ r: radius, km: Math.round(adaptiveGroundM / 1000) }
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
		if (nativeSnapTimer) {
			clearTimeout(nativeSnapTimer);
			nativeSnapTimer = 0;
		}
		stopZoomAssess();
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

	function stopZoomAssess() {
		if (zoomAssessTimer) {
			clearInterval(zoomAssessTimer);
			zoomAssessTimer = 0;
		}
	}

	function startZoomAssess() {
		stopZoomAssess();
		zoomAssessTimer = setInterval(() => assessAndMaybeAdjustZoom(), ZOOM_ASSESS_INTERVAL_MS / 3);
	}

	/** Ground radius for a point on the city<->storm adaptive slider. */
	function groundMForT(t) {
		return CITY_GROUND_M + (STORM_GROUND_M - CITY_GROUND_M) * t;
	}

	/** Re-renders the canvas at native resolution for the given target scale
	 *  and drops the CSS zoom back to identity, with its transition
	 *  suppressed for one frame so the swap from the (softer, CSS-scaled)
	 *  transitional frame to the crisp native one is invisible. Without
	 *  this, the canvas stays baked in at the wide intro scale forever and
	 *  every tighter view is just that same raster stretched via CSS
	 *  transform - soft, and zooming in never actually reveals more detail. */
	function snapToNative(targetScale) {
		if (!composed) return;
		suppressTransition = true;
		viewScale = targetScale;
		zoomFactor = 1;
		drawCurrent();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				suppressTransition = false;
			});
		});
	}

	function scheduleNativeSnap(targetScale) {
		if (nativeSnapTimer) {
			clearTimeout(nativeSnapTimer);
			nativeSnapTimer = 0;
		}
		if (reducedMotion) {
			snapToNative(targetScale);
			return;
		}
		nativeSnapTimer = setTimeout(() => {
			nativeSnapTimer = 0;
			snapToNative(targetScale);
		}, introDurationMs());
	}

	/** Recomputes the reactive ground radius + CSS zoom factor for the given
	 *  point on the adaptive slider (0 = tight city, 1 = wide storm view).
	 *  The CSS transform only carries the view through the transition itself
	 *  - once it's had time to finish, the canvas snaps to a native render
	 *  at the target scale so the settled view is genuinely sharp. */
	function applyAdaptiveZoom(t) {
		adaptiveGroundM = groundMForT(t);
		const targetScale = scaleForGroundRadius(radius, currentLat, BASE_ZOOM, adaptiveGroundM);
		zoomFactor = targetScale / viewScale;
		scheduleNativeSnap(targetScale);
	}

	/** Builds a transparent-background canvas holding just the current
	 *  frame's radar sprites (no basemap), in the same pixel grid as
	 *  `composed.basemap`, so precipitation alpha can be sampled without the
	 *  opaque basemap fill destroying it. */
	function buildRadarAlphaCanvas(layer) {
		const cols = composed.x1 - composed.x0 + 1;
		const rows = composed.y1 - composed.y0 + 1;
		const c = document.createElement('canvas');
		c.width = cols * TILE_SIZE;
		c.height = rows * TILE_SIZE;
		const actx = c.getContext('2d', { alpha: true });
		const k = RADAR_SIZE / TILE_SIZE;
		for (const sprite of layer) {
			if (!sprite.img) continue;
			actx.drawImage(
				sprite.img,
				(sprite.tx * k - composed.x0) * TILE_SIZE,
				(sprite.ty * k - composed.y0) * TILE_SIZE,
				RADAR_SIZE,
				RADAR_SIZE
			);
		}
		return c;
	}

	/** Average precip alpha coverage across the circle currently in view,
	 *  and just its outer edge — strong coverage right at the edge means the
	 *  system is very likely bigger than what's on screen. */
	function assessPrecipCoverage() {
		if (!composed) return null;
		const layer = composed.radarLayers[frameIndex];
		if (!layer) return null;
		const alphaCanvas = buildRadarAlphaCanvas(layer);
		const actx = alphaCanvas.getContext('2d');
		const homeX = (composed.fracX - composed.x0) * TILE_SIZE;
		const homeY = (composed.fracY - composed.y0) * TILE_SIZE;
		const r = groundMForT(adaptiveT) / metersPerPixel(currentLat, BASE_ZOOM);
		const sx = Math.max(0, Math.floor(homeX - r));
		const sy = Math.max(0, Math.floor(homeY - r));
		const ex = Math.min(alphaCanvas.width, Math.ceil(homeX + r));
		const ey = Math.min(alphaCanvas.height, Math.ceil(homeY + r));
		const w = ex - sx;
		const h = ey - sy;
		if (w <= 0 || h <= 0) return null;
		const { data } = actx.getImageData(sx, sy, w, h);
		const cx0 = homeX - sx;
		const cy0 = homeY - sy;
		const edgeR2 = (r * 0.72) ** 2;
		const fullR2 = r * r;
		let edgeAlpha = 0,
			edgeCount = 0,
			totalAlpha = 0,
			totalCount = 0;
		for (let y = 0; y < h; y++) {
			const dy = y - cy0;
			for (let x = 0; x < w; x++) {
				const dx = x - cx0;
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
	 *  gated to an occasional check with a same-direction streak so it
	 *  doesn't flicker between levels as a storm edge drifts near the ring. */
	function assessAndMaybeAdjustZoom() {
		if (!hasIntroduced) return;
		const now = performance.now();
		if (now - lastZoomAssessAt < ZOOM_ASSESS_INTERVAL_MS) return;
		lastZoomAssessAt = now;

		const coverage = assessPrecipCoverage();
		if (!coverage) return;

		let direction = 0;
		if (coverage.edgeCoverage > EDGE_COVERAGE_ZOOM_OUT && adaptiveT < 1) direction = 1;
		else if (coverage.totalCoverage < TOTAL_COVERAGE_ZOOM_IN && adaptiveT > 0) direction = -1;

		if (direction !== 0 && direction === pendingZoomDir) {
			pendingZoomStreak++;
		} else {
			pendingZoomDir = direction;
			pendingZoomStreak = direction === 0 ? 0 : 1;
		}

		if (direction !== 0 && pendingZoomStreak >= ZOOM_STREAK_NEEDED) {
			adaptiveT = Math.max(0, Math.min(1, adaptiveT + direction * ZOOM_STEP));
			pendingZoomStreak = 0;
			pendingZoomDir = 0;
			applyAdaptiveZoom(adaptiveT);
		}
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
		applyAdaptiveZoom(adaptiveT);
		drawCurrent();
		startAnim();
		startZoomAssess();
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
		currentLat = lat;
		introScale = scaleForGroundRadius(lay.radius, lat, BASE_ZOOM, INTRO_GROUND_M);

		// Tile coverage is fetched to cover the intro's own (wider) ground
		// radius, same as before this change - STORM_GROUND_M is kept inside
		// that bound, so the adaptive zoom-out is a pure CSS zoom onto tiles
		// already being fetched, not an additional, much larger fetch.
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
		dpr = Math.min(window.devicePixelRatio || 1, 2);
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
		currentLat = lat;
		introScale = scaleForGroundRadius(lay.radius, lat, BASE_ZOOM, INTRO_GROUND_M);
		viewScale = introScale;
		applyAdaptiveZoom(adaptiveT);
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
		<div class="map-zoom" class:city={zoomedIn} class:no-anim={suppressTransition}>
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
	.map-zoom.no-anim {
		transition: none;
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
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
