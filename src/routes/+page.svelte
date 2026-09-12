<!--
	Hallmark design scores
	Philosophy 5 · Hierarchy 5 · Execution 5 · Specificity 4 · Restraint 4 · Variety 5
	Moody-ambient IA: the liquid-metal field is cursor-reactive and carries the
	dithered, molten identity; glass now refracts through every view sheet
	(school/dev/weather), not just the trough, with a single sheened+liquid-
	distorted hero surface active at a time. Nav uses one sliding indicator,
	not a static per-tab pill.
-->
<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { currentView, displayMode, weather, weatherDetail, rainPrediction, nowPlaying, wsStatus, islandQueue, pushIslandEvent } from '$lib/stores.js';
	import { gpuLowPowerMode, toggleGpuLowPower } from '$lib/services/ollamaArbiter.js';
	import { startSystemWatch } from '$lib/services/systemWatch.js';
	import { primeAudio, playChime } from '$lib/services/chime.js';
	import { atmosphereFromWeather, phaseKicker } from '$lib/atmosphere.js';
	import { sampleRadarNowcast } from '$lib/radarNowcast.js';
	import { mergeRadarPrediction } from '$lib/rainModel.js';
	import { islandWeatherSlip, splitNwsAlerts, tickerText } from '$lib/nwsAlerts.js';
	import LiquidMetalCanvas from '$lib/shaders/LiquidMetalCanvas.svelte';
	import DynamicIsland from '$lib/components/DynamicIsland.svelte';
	import SevereTicker from '$lib/components/SevereTicker.svelte';
	import BoardWidgets from '$lib/components/BoardWidgets.svelte';
	import HeroClock from '$lib/components/HeroClock.svelte';
	import SchoolHub from '$lib/components/SchoolHub.svelte';
	import DevHub from '$lib/components/DevHub.svelte';
	import MusicView from '$lib/components/MusicView.svelte';
	import WeatherView from '$lib/components/WeatherView.svelte';
	import RadarCanvas from '$lib/components/RadarCanvas.svelte';
	import AmbientDeck from '$lib/components/AmbientDeck.svelte';
	import NoiseOverlay from '$lib/components/NoiseOverlay.svelte';

	let ws;
	let reconnectTimer;
	let hadDroppedConnection = false;
	let time = $state(new Date());
	let weatherData = $state(null);
	let weatherLoading = $state(true);
	let mode = $state('normal');
	let hdmiOff = $state(false);
	let navEl = $state(null);
	let tabRefs = $state([]);
	let indicator = $state({ left: 0, width: 0, ready: false });
	let indicatorMorphing = $state(false);
	let indicatorMorphTimer = 0;
	// Plain (non-reactive) shadow of the indicator's last position. updateIndicator
	// both reads and writes this to detect movement; using $state for that read
	// would make the enclosing $effect depend on its own write and loop forever.
	let lastIndicatorPos = { left: 0, width: 0, set: false };
	// Same idea for the view-swap chime below: plain, not $state, so reading
	// it in the effect that reacts to $currentView doesn't create a
	// self-triggering loop.
	let lastViewIdx = -1;

	const VIEWS = ['clock', 'school', 'dev', 'music', 'weather'];

	function updateIndicator() {
		const idx = VIEWS.indexOf($currentView);
		const btn = tabRefs[idx];
		if (!btn || !navEl) return;
		const navRect = navEl.getBoundingClientRect();
		const btnRect = btn.getBoundingClientRect();
		const left = btnRect.left - navRect.left;
		const width = btnRect.width;
		const moved = lastIndicatorPos.set && (left !== lastIndicatorPos.left || width !== lastIndicatorPos.width);
		lastIndicatorPos = { left, width, set: true };
		indicator = { left, width, ready: true };
		if (moved && typeof window !== 'undefined') {
			const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			if (!reduced) {
				indicatorMorphing = true;
				clearTimeout(indicatorMorphTimer);
				indicatorMorphTimer = setTimeout(() => {
					indicatorMorphing = false;
				}, 560);
			}
		}
	}

	function applyDisplay(display) {
		if (!display) return;
		if (display.hdmi === 'off') {
			hdmiOff = true;
			if (mode !== 'sleep') {
				mode = 'sleep';
				displayMode.set('sleep');
			}
		}
		if (display.hdmi === 'on') {
			hdmiOff = false;
			if (mode === 'sleep') {
				mode = 'normal';
				displayMode.set('normal');
			}
		}
	}

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => {
			if (hadDroppedConnection) {
				pushIslandEvent({ title: 'Network restored', body: 'Reconnected', severity: 'ok', ttl: 4000 });
			}
			hadDroppedConnection = false;
			wsStatus.set('connected');
		};
		ws.onclose = () => {
			if (!hadDroppedConnection) {
				pushIslandEvent({ title: 'Network issue', body: 'Lost connection, retrying', severity: 'warn', ttl: 8000 });
			}
			hadDroppedConnection = true;
			wsStatus.set('disconnected');
			reconnectTimer = setTimeout(connect, 2000);
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === 'navigate') {
					currentView.set(msg.view);
				}
				if (msg.type === 'notify') {
					pushIslandEvent({
						title: msg.title || 'Notice',
						body: msg.body || '',
						severity: msg.severity || 'info',
						ttl: msg.ttl || 9000,
						source: msg.source || ''
					});
				}
				if (msg.type === 'trigger' && msg.event === 'morning') {
					mode = 'morning';
					displayMode.set('morning');
					pushIslandEvent({
						title: 'Good morning',
						body: 'Briefing ready. Check due work.',
						severity: 'info',
						ttl: 8000,
						source: 'Display',
						kind: 'briefing'
					});
					currentView.set(msg.view || 'school');
				}
				if (msg.type === 'init') {
					if (msg.view) currentView.set(msg.view);
					applyDisplay(msg.display);
				}
				if (msg.type === 'display') {
					applyDisplay(msg);
				}
				if (msg.type === 'trigger' && msg.event === 'sleep') {
					mode = 'sleep';
					displayMode.set('sleep');
					pushIslandEvent({
						title: 'Sleep mode',
						body: 'Panel off for the night. See you tomorrow.',
						severity: 'info',
						ttl: 4000,
						source: 'Display'
					});
				}
				if (msg.type === 'trigger' && msg.event === 'normal') {
					mode = 'normal';
					displayMode.set('normal');
					pushIslandEvent({
						title: 'Normal mode',
						body: 'Resuming full display.',
						severity: 'info',
						ttl: 3000,
						source: 'Display'
					});
				}
				if (msg.type === 'trigger' && msg.event === 'hdmi_off') {
					hdmiOff = true;
				}
				if (msg.type === 'trigger' && msg.event === 'hdmi_on') {
					hdmiOff = false;
					if (mode === 'sleep') {
						mode = 'normal';
						displayMode.set('normal');
					}
				}
				if (msg.type === 'power') {
					window.dispatchEvent(new CustomEvent('power-state', { detail: msg.state }));
				}
			} catch {
				/* ignore malformed frames */
			}
		};
	}

	async function fetchWeather() {
		weatherLoading = true;
		try {
			const r = await fetch('/api/weather?hours=48');
			weatherData = await r.json();
			try {
				const samples = await sampleRadarNowcast(weatherData?.rad);
				if (samples.length) {
					weatherData = {
						...weatherData,
						radarNowcast: samples,
						prediction: mergeRadarPrediction(weatherData.prediction, samples)
					};
				}
			} catch {
				/* nowcast sample is optional */
			}
			const cur = weatherData?.current || {};
			weather.set({ temp: cur.temp ?? '--', desc: cur.desc ?? '--' });
			weatherDetail.set(weatherData);
			rainPrediction.set(
				weatherData?.prediction || { rain30min: 0, rain60min: 0, rain120min: 0, source: 'forecast' }
			);
			weatherLoading = false;
		} catch {
			weatherLoading = false;
		}
	}

	async function fetchNowPlaying() {
		try {
			const r = await fetch('/api/nowplaying');
			if (!r.ok) return;
			nowPlaying.set(await r.json());
		} catch {
			/* playerctl is optional */
		}
	}

	function handleKey(e) {
		if (e.altKey && (e.key === 'y' || e.key === 'Y')) {
			toggleGpuLowPower();
			return;
		}
		let idx = VIEWS.indexOf($currentView);
		if (idx === -1) idx = 0;
		if (e.key === 'ArrowRight') {
			currentView.set(VIEWS[(idx + 1) % VIEWS.length]);
		}
		if (e.key === 'ArrowLeft') {
			currentView.set(VIEWS[(idx - 1 + VIEWS.length) % VIEWS.length]);
		}
	}

	onMount(() => {
		connect();
		fetchWeather();
		fetchNowPlaying();
		const stopSystemWatch = startSystemWatch();
		const clock = setInterval(() => {
			time = new Date();
		}, 1000);
		const music = setInterval(fetchNowPlaying, 4000);
		const wx = setInterval(fetchWeather, 300000);
		window.addEventListener('keydown', handleKey);
		window.addEventListener('resize', updateIndicator, { passive: true });
		// Browsers block audio until a real user gesture; a touch/click/key on
		// the kiosk unlocks it so island-event chimes can play afterward.
		window.addEventListener('pointerdown', primeAudio, { once: true });
		window.addEventListener('keydown', primeAudio, { once: true });
		updateIndicator();
		if (new URLSearchParams(window.location.search).get('wx') === 'notify') {
			pushIslandEvent({
				title: 'Cursor finished',
				body: 'Radar island layout is ready',
				severity: 'ok',
				ttl: 12000,
				source: 'Cursor'
			});
		}
		return () => {
			clearInterval(clock);
			clearInterval(music);
			clearInterval(wx);
			clearTimeout(reconnectTimer);
			stopSystemWatch();
			window.removeEventListener('keydown', handleKey);
			window.removeEventListener('resize', updateIndicator);
			window.removeEventListener('pointerdown', primeAudio);
			window.removeEventListener('keydown', primeAudio);
			ws?.close();
		};
	});

	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' }));
	let dayNum = $derived(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDate());
	let clockLabel = $derived(
		time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
	);
	let atm = $derived(atmosphereFromWeather(time.getTime(), weatherData));
	let clockKicker = $derived(phaseKicker(atm.phase, weekday));

	const VIEW_TITLES = {
		school: 'Due Work',
		dev: 'Dev Wall',
		music: 'Music',
		weather: 'Weather'
	};
	let viewTitle = $derived(VIEW_TITLES[$currentView] ?? '');

	function viewLabel(name) {
		return name.slice(0, 1).toUpperCase() + name.slice(1);
	}

	function weatherFromQuery() {
		if (typeof window === 'undefined') return null;
		const wx = new URLSearchParams(window.location.search).get('wx');
		if (wx === 'warning') {
			return {
				alerts: [
					{
						event: 'Tornado Warning',
						severity: 'Extreme',
						headline: 'Tornado Warning for Pinellas including Largo until 4:15 PM EDT'
					}
				]
			};
		}
		if (wx === 'watch') {
			return {
				alerts: [{ event: 'Tornado Watch', severity: 'Moderate', headline: 'Watch until 8 PM EDT' }]
			};
		}
		if (wx === 'rain') {
			return { alerts: [], prediction: { rain30min: 0.72, rain60min: 0.8, rain120min: 0.2, approaching: true, etaMin: 18, source: 'nowcast+forecast' } };
		}
		if (wx === 'advisory') {
			return {
				alerts: [{ event: 'Heat Advisory', severity: 'Moderate', headline: 'Until 7 PM EDT' }]
			};
		}
		if (wx === 'hurricane') {
			return {
				alerts: [
					{
						event: 'Hurricane Warning',
						severity: 'Extreme',
						headline: 'Hurricane Warning for coastal Pinellas including Largo'
					}
				]
			};
		}
		if (wx === 'notify') {
			return { notify: true };
		}
		return null;
	}

	let wxForIsland = $derived.by(() => {
		const override = weatherFromQuery();
		if (!override || override.notify) return weatherData;
		return { ...(weatherData || {}), ...override };
	});
	let islandWeather = $derived(islandWeatherSlip(wxForIsland));
	let extremeTicker = $derived(tickerText(splitNwsAlerts(wxForIsland?.alerts).extreme));
	let islandActive = $derived($islandQueue.length > 0 || $nowPlaying?.playing || islandWeather.active);

	$effect(() => {
		const idx = VIEWS.indexOf($currentView);
		updateIndicator();
		if (idx !== -1 && lastViewIdx !== -1 && idx !== lastViewIdx) {
			// Shortest path around the tab strip decides the chime's direction,
			// so wrapping from the last tab to the first (or back) still reads
			// as "forward"/"backward" rather than the raw index jump.
			const n = VIEWS.length;
			const forwardDist = (idx - lastViewIdx + n) % n;
			playChime(forwardDist <= n / 2 ? 'swap-next' : 'swap-prev');
		}
		lastViewIdx = idx;
	});
</script>

<svelte:head>
	<title>Smart Display</title>
</svelte:head>

<a class="skip" href="#main-stage">Skip to view</a>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
	<defs>
		<filter id="liquid-glass" x="-20%" y="-20%" width="140%" height="140%">
			<feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" result="noise" />
			<feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
		</filter>
		<filter id="nav-goo" x="-60%" y="-60%" width="220%" height="220%">
			<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
			<feColorMatrix
				in="blur"
				mode="matrix"
				values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10"
				result="goo"
			/>
			<feBlend in="SourceGraphic" in2="goo" />
		</filter>
	</defs>
</svg>

<div class="display-shell" class:sleep={mode === 'sleep'} class:hdmi-off={hdmiOff}>
	<LiquidMetalCanvas
		isLowPower={$gpuLowPowerMode || mode === 'sleep'}
		sun={atm.sun}
		twilight={atm.twilight}
		rain={atm.rain}
		wind={atm.wind}
		cloud={atm.cloud}
		windDir={atm.windRad}
	/>

	<DynamicIsland
		nowPlaying={$nowPlaying}
		weatherData={wxForIsland}
		events={$islandQueue}
		onweather={() => currentView.set('weather')}
	/>

	<div
		class="display-root"
		class:morning={mode === 'morning'}
		class:sleep={mode === 'sleep'}
		class:wx-rain={atm.rain >= 0.35}
		data-phase={atm.phase}
	>
		<header class="zone top">
			<div class="top-row">
				<nav class="view-strip" aria-label="Views" bind:this={navEl}>
					<span
						class="tab-indicator"
						class:ready={indicator.ready}
						class:morphing={indicatorMorphing}
						style="--ind-left: {indicator.left}px; --ind-width: {indicator.width}px"
						aria-hidden="true"
					></span>
					{#each VIEWS as v, i}
						<button
							class="view-tab"
							class:active={$currentView === v}
							onclick={() => currentView.set(v)}
							aria-current={$currentView === v ? 'page' : undefined}
							bind:this={tabRefs[i]}
						>
							<span class="view-tab-label">{viewLabel(v)}</span>
						</button>
					{/each}
				</nav>
				<div class="status-cluster">
					<p class="dateline" class:receded={islandActive}>
						{weekday}, {month}&nbsp;{dayNum}
						{#if $currentView !== 'clock'}
							<span class="time num">{clockLabel}</span>
						{/if}
					</p>
					<p class="wxline" class:receded={islandActive}>
						{#if weatherLoading}
							<span class="skeleton inline"></span>
						{:else if $weather.temp !== '--'}
							<span class="num">{$weather.temp}°</span>
							{$weather.desc}
							{#if atm.compass && atm.compass !== '--'}
								<span class="wx-wind">{atm.compass} {Math.round(atm.windSpeed)} mph</span>
							{/if}
						{/if}
					</p>
				</div>
			</div>
			{#if extremeTicker}
				<SevereTicker text={extremeTicker} />
			{/if}
			{#if $currentView !== 'clock'}
				<h1 class="view-title">{viewTitle}</h1>
			{/if}
		</header>

		<main id="main-stage" class="zone center">
			{#if $currentView === 'clock'}
				<section class="view-pane clock-pane">
					<div class="clock-credits">
						<p class="clock-kicker">{clockKicker}</p>
						<HeroClock {time} size="poster" />
						<BoardWidgets {atm} prediction={wxForIsland?.prediction || weatherData?.prediction} />
					</div>
				</section>
			{:else if $currentView === 'school'}
				<section class="view-pane sheet school-pane" data-glass>
					<SchoolHub />
				</section>
			{:else if $currentView === 'dev'}
				<section class="view-pane sheet dev-pane" data-glass>
					<DevHub />
				</section>
			{:else if $currentView === 'music'}
				<section class="view-pane music-pane">
					<MusicView />
				</section>
			{:else if $currentView === 'weather'}
				<section class="view-pane sheet weather-pane" data-glass>
					<div class="radar-bleed">
						<RadarCanvas data={weatherData} />
					</div>
					<div class="weather-trough">
						<WeatherView data={weatherData} />
					</div>
				</section>
			{/if}
		</main>

		<footer class="zone bottom">
			<div class="equator" aria-hidden="true">
				{#each Array(16) as _, i (i)}
					<span>+</span>
				{/each}
			</div>
			<div class="trough glass-field" data-glass>
				<AmbientDeck {atm} prediction={wxForIsland?.prediction || weatherData?.prediction} />
			</div>
		</footer>
	</div>

	<NoiseOverlay />
</div>

<style>
	.skip {
		position: absolute;
		left: var(--space-4);
		top: var(--space-4);
		z-index: 40;
		transform: translateY(-160%);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--foreground);
		color: var(--abyss);
		font-family: var(--font-body);
		font-weight: 600;
		text-decoration: none;
	}
	.skip:focus {
		transform: none;
	}
	.display-shell {
		width: 100vw;
		height: 100dvh;
		min-height: 100dvh;
		overflow-x: clip;
		overflow-y: hidden;
		position: relative;
		background: var(--background);
	}
	.display-root {
		position: relative;
		z-index: 10;
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		color: var(--text-primary);
		font-family: var(--font-body);
		min-width: 0;
	}
	.zone {
		width: 100%;
		padding: 0 var(--space-8);
		box-sizing: border-box;
		min-width: 0;
	}
	.top {
		height: auto;
		min-height: 0;
		padding-top: var(--space-8);
		padding-bottom: var(--space-4);
		overflow: visible;
	}
	/* Nav and the date/weather line share one row, at the same Y, with the
	   date/weather pushed hard to the right edge — the Dynamic Island lives
	   independently of this row now (fixed, top-center), so this is free to
	   just be a plain left/right split. */
	.top-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-8);
		width: 100%;
		min-width: 0;
	}
	.status-cluster {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-4);
		flex-shrink: 0;
		min-width: 0;
	}
	.dateline,
	.wxline {
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: -0.025em;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
		min-width: 0;
		line-height: 1.2;
	}
	.wxline .num {
		margin-right: var(--space-2);
		color: var(--foreground);
	}
	.wx-wind {
		margin-left: var(--space-2);
		color: var(--text-tertiary);
		font-weight: 500;
	}
	.display-root.wx-rain .wxline {
		color: var(--scan);
	}
	.dateline,
	.wxline {
		transition: opacity 320ms var(--spring-smooth);
	}
	.dateline.receded,
	.wxline.receded {
		opacity: 0.32;
	}
	@media (prefers-reduced-motion: reduce) {
		.dateline,
		.wxline {
			transition: opacity 240ms var(--spring-smooth);
		}
	}
	.view-title {
		margin: var(--space-6) 0 0;
		font-family: var(--font-body);
		font-size: clamp(2.25rem, 4.4vw, 3.75rem);
		font-weight: 700;
		font-style: normal;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.dateline .time {
		margin-left: var(--space-3);
		padding-left: var(--space-3);
		border-left: 1px solid var(--hairline);
		color: var(--brand);
	}
	.view-strip {
		position: relative;
		display: flex;
		align-items: stretch;
		width: max-content;
		max-width: 100%;
		gap: var(--space-2);
		padding: 0;
		min-width: 0;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
		box-sizing: border-box;
	}
	.tab-indicator {
		position: absolute;
		top: 0;
		bottom: 0;
		left: var(--ind-left, 0);
		width: var(--ind-width, 0);
		border-radius: 999px;
		background: color-mix(in srgb, var(--brand) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
		box-shadow: 0 0 18px color-mix(in srgb, var(--brand) 22%, transparent);
		opacity: 0;
		pointer-events: none;
		z-index: 0;
	}
	.tab-indicator.ready {
		opacity: 1;
		transition:
			left 520ms var(--spring-bouncy),
			width 520ms var(--spring-bouncy),
			opacity 240ms var(--spring-smooth);
	}
	.tab-indicator.morphing {
		filter: url(#nav-goo);
	}
	@media (prefers-reduced-motion: reduce) {
		.tab-indicator.ready {
			transition: opacity 240ms var(--spring-smooth);
		}
	}
	.view-tab {
		position: relative;
		z-index: 1;
		appearance: none;
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--text-tertiary);
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 500;
		letter-spacing: -0.01em;
		text-transform: none;
		padding: var(--space-2) var(--space-5);
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 280ms var(--spring-smooth),
			transform 320ms var(--spring-bouncy);
	}
	.view-tab:hover {
		color: var(--text-secondary);
	}
	.view-tab:active {
		transform: scale(0.92);
		transition-duration: 90ms;
	}
	.view-tab.active {
		color: var(--foreground);
	}
	.view-tab-label {
		display: inline-block;
	}
	.center {
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		padding-top: var(--space-6);
		padding-bottom: var(--space-6);
	}
	.view-pane {
		position: relative;
		overflow: hidden;
		min-width: 0;
		min-height: 0;
	}
	@media (prefers-reduced-motion: no-preference) {
		.view-pane {
			animation: pane-in var(--dur-pane) var(--spring-smooth) both;
		}
		.view-tab:hover:not(.active):not(:active) {
			transform: translateY(-1px);
		}
	}
	.clock-pane,
	.music-pane {
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: flex-start;
	}
	.clock-pane {
		pointer-events: none;
	}
	.music-pane {
		pointer-events: auto;
	}
	.clock-credits {
		min-width: 0;
		max-width: min(96%, 46rem);
		padding: 0 0 var(--space-2);
	}
	.clock-credits :global(.widgets) {
		margin-top: var(--space-4);
	}
	.clock-kicker {
		margin: 0 0 var(--space-2);
		font-family: var(--font-body);
		font-size: var(--text-xl);
		font-weight: 500;
		letter-spacing: -0.02em;
		color: var(--text-tertiary);
	}
	.display-root[data-phase='dawn'] .clock-kicker {
		color: var(--ok);
	}
	.display-root[data-phase='dusk'] .clock-kicker {
		color: var(--solve);
	}
	.display-root[data-phase='night'] .clock-kicker {
		color: var(--brand);
	}
	.school-pane {
		--sheet-glow: radial-gradient(
			44rem 26rem at 8% -6%,
			var(--glow-brand),
			transparent 70%
		);
	}
	.dev-pane {
		--sheet-glow: radial-gradient(
			44rem 26rem at 92% -6%,
			var(--glow-solve),
			transparent 70%
		);
	}
	.weather-pane {
		min-height: 0;
		background: color-mix(in srgb, var(--abyss) 8%, transparent);
		--sheet-glow: radial-gradient(
			44rem 26rem at 50% -8%,
			var(--glow-scan),
			transparent 70%
		);
	}
	.radar-bleed {
		position: absolute;
		inset: 0;
		z-index: 0;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border-radius: inherit;
	}
	.weather-trough {
		position: relative;
		z-index: 1;
		margin-left: auto;
		width: min(36rem, 44%);
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		padding-left: var(--space-4);
		border-left: 1px solid var(--hairline);
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in srgb, var(--abyss) 42%, transparent) 18%,
			color-mix(in srgb, var(--abyss) 78%, transparent) 55%
		);
	}
	.bottom {
		height: auto;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-3);
		padding-bottom: var(--space-8);
	}
	.equator {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 0 var(--space-1);
		font-family: var(--font-code);
		font-size: var(--text-sm);
		line-height: 1;
		color: color-mix(in srgb, var(--foreground) 22%, transparent);
		pointer-events: none;
		user-select: none;
	}
	.trough {
		width: 100%;
		height: 6rem;
		min-width: 0;
		border-radius: var(--radius-md);
	}
	.trough.glass-field::before {
		display: none;
	}
	.sleep .display-root {
		opacity: 0.15;
		filter: grayscale(0.85);
		transition: opacity 1.2s var(--spring-smooth), filter 1.2s var(--spring-smooth);
	}
	.display-shell.hdmi-off .display-root {
		opacity: 0;
		transition: opacity 2.5s var(--spring-smooth);
	}
	.display-shell.hdmi-off {
		background: var(--background);
	}
	.display-root.morning {
		animation: morningGlow 8s var(--spring-smooth) infinite alternate;
	}
	@keyframes morningGlow {
		from { box-shadow: inset 0 0 0 transparent; }
		to { box-shadow: inset 0 0 120px color-mix(in srgb, var(--ok) 8%, transparent); }
	}

	@media (max-aspect-ratio: 4/3) {
		.top-row {
			flex-wrap: wrap;
			align-items: flex-start;
		}
		.status-cluster {
			justify-content: flex-end;
			width: 100%;
			padding-bottom: 0;
		}
		.weather-trough {
			width: 100%;
			height: auto;
			max-height: 48%;
			margin-left: 0;
			margin-top: auto;
			border-left: 0;
			border-top: 1px solid var(--hairline);
			padding-left: 0;
			padding-top: var(--space-4);
			background: linear-gradient(
				0deg,
				color-mix(in srgb, var(--abyss) 86%, transparent) 55%,
				transparent
			);
		}
	}

	@media (max-width: 768px) {
		.display-shell {
			height: auto;
			min-height: 100dvh;
			overflow-y: visible;
		}
		.display-root {
			height: auto;
			min-height: 100dvh;
			grid-template-rows: auto auto auto;
		}
		.zone {
			padding-inline: var(--space-4);
		}
		.top {
			padding-top: var(--space-4);
		}
		.top-row {
			flex-direction: column;
			align-items: stretch;
		}
		.status-cluster {
			justify-content: flex-end;
			padding-bottom: 0;
		}
		.view-strip {
			width: 100%;
			flex-wrap: wrap;
			gap: var(--space-4);
			border-radius: 0;
		}
		.center {
			height: auto;
			min-height: 0;
			padding-top: var(--space-4);
			padding-bottom: var(--space-4);
		}
		.view-pane {
			min-height: 420px;
			width: 100%;
		}
		.clock-pane,
		.music-pane {
			justify-content: flex-start;
			min-height: 14rem;
		}
		.clock-credits {
			max-width: 100%;
		}
		.bottom {
			min-height: 0;
		}
	}
</style>
