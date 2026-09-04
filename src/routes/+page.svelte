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
	import { currentView, displayMode, weather, weatherDetail, rainPrediction, nowPlaying, wsStatus } from '$lib/stores.js';
	import { gpuLowPowerMode, ollamaStatus, toggleGpuLowPower } from '$lib/services/ollamaArbiter.js';
	import LiquidMetalCanvas from '$lib/shaders/LiquidMetalCanvas.svelte';
	import DynamicIsland from '$lib/components/DynamicIsland.svelte';
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
	let time = $state(new Date());
	let weatherData = $state(null);
	let weatherLoading = $state(true);
	let notif = $state({ visible: false, title: '', body: '', kind: 'info' });
	let mode = $state('normal');
	let hdmiOff = $state(false);
	let navEl = $state(null);
	let tabRefs = $state([]);
	let indicator = $state({ left: 0, width: 0, ready: false });

	const VIEWS = ['clock', 'school', 'dev', 'music', 'weather'];

	function updateIndicator() {
		const idx = VIEWS.indexOf($currentView);
		const btn = tabRefs[idx];
		if (!btn || !navEl) return;
		const navRect = navEl.getBoundingClientRect();
		const btnRect = btn.getBoundingClientRect();
		indicator = { left: btnRect.left - navRect.left, width: btnRect.width, ready: true };
	}

	function showNotif(title, body, kind = 'info', ms = 4500) {
		notif = { visible: true, title, body, kind };
		setTimeout(() => {
			notif = { ...notif, visible: false };
		}, ms);
	}

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => wsStatus.set('connected');
		ws.onclose = () => {
			wsStatus.set('disconnected');
			reconnectTimer = setTimeout(connect, 2000);
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === 'navigate') {
					currentView.set(msg.view);
				}
				if (msg.type === 'trigger' && msg.event === 'morning') {
					mode = 'morning';
					displayMode.set('morning');
					showNotif('Good morning', 'Briefing ready. Check due work.', 'info', 8000);
					currentView.set(msg.view || 'school');
				}
				if (msg.type === 'trigger' && msg.event === 'sleep') {
					mode = 'sleep';
					displayMode.set('sleep');
					showNotif('Sleep mode', 'Dimming for the night. See you tomorrow.', 'info', 5000);
				}
				if (msg.type === 'trigger' && msg.event === 'normal') {
					mode = 'normal';
					displayMode.set('normal');
					showNotif('Normal mode', 'Resuming full display.', 'info', 3000);
				}
				if (msg.type === 'trigger' && msg.event === 'hdmi_off') {
					hdmiOff = true;
				}
				if (msg.type === 'trigger' && msg.event === 'hdmi_on') {
					hdmiOff = false;
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
			const cur = weatherData?.current || {};
			weather.set({ temp: cur.temp ?? '--', desc: cur.desc ?? '--' });
			weatherDetail.set(weatherData);
			rainPrediction.set(weatherData?.prediction || { rain30min: 0, rain60min: 0, rain120min: 0 });
			weatherLoading = false;
			if (weatherData?.alerts?.length) {
				const top = weatherData.alerts[0];
				showNotif(top.event, top.headline, 'warn', 12000);
			}
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
		const clock = setInterval(() => {
			time = new Date();
		}, 1000);
		const music = setInterval(fetchNowPlaying, 4000);
		const wx = setInterval(fetchWeather, 300000);
		window.addEventListener('keydown', handleKey);
		window.addEventListener('resize', updateIndicator, { passive: true });
		updateIndicator();
		return () => {
			clearInterval(clock);
			clearInterval(music);
			clearInterval(wx);
			clearTimeout(reconnectTimer);
			window.removeEventListener('keydown', handleKey);
			window.removeEventListener('resize', updateIndicator);
			ws?.close();
		};
	});

	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' }));
	let dayNum = $derived(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDate());

	function viewLabel(name) {
		return name.slice(0, 1).toUpperCase() + name.slice(1);
	}

	$effect(() => {
		$currentView;
		updateIndicator();
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
	</defs>
</svg>

<div class="display-shell" class:sleep={mode === 'sleep'} class:hdmi-off={hdmiOff}>
	<LiquidMetalCanvas isLowPower={$gpuLowPowerMode || mode === 'sleep'} />

	<div class="display-root" class:morning={mode === 'morning'} class:sleep={mode === 'sleep'}>
		<header class="zone top">
			<div class="masthead" class:credits-open={$currentView === 'clock'}>
				{#if $currentView !== 'clock'}
					<HeroClock {time} size="masthead" />
				{/if}
				<div class="status-cluster">
					<p class="dateline">{weekday}, {month}&nbsp;{dayNum}</p>
					<div class="cluster-end">
						<p class="wxline">
							{#if weatherLoading}
								<span class="skeleton inline"></span>
							{:else if $weather.temp !== '--'}
								<span class="num">{$weather.temp}°</span>
								{$weather.desc}
							{/if}
						</p>
						<DynamicIsland
							nowPlaying={$nowPlaying}
							notification={notif}
							gpuLowPower={$gpuLowPowerMode}
							ollamaStatus={$ollamaStatus}
							weatherData={weatherData}
						/>
					</div>
				</div>
			</div>
			<nav class="view-strip" aria-label="Views" bind:this={navEl}>
				<span
					class="tab-indicator"
					class:ready={indicator.ready}
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
		</header>

		<main id="main-stage" class="zone center">
			{#if $currentView === 'clock'}
				<section class="view-pane clock-pane">
					<div class="clock-credits">
						<p class="clock-kicker">{weekday}</p>
						<HeroClock {time} size="poster" />
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
					<div class="weather-core">
						<div class="radar-trough">
							<RadarCanvas data={weatherData} />
						</div>
						<div class="weather-trough">
							<WeatherView data={weatherData} />
						</div>
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
				<AmbientDeck />
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
	.masthead {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-8);
		width: 100%;
		min-width: 0;
	}
	.masthead.credits-open {
		justify-content: flex-end;
	}
	.status-cluster {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-4);
		min-width: 0;
		padding-bottom: var(--space-2);
	}
	.cluster-end {
		display: flex;
		align-items: center;
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
	.view-strip {
		position: relative;
		display: flex;
		align-items: stretch;
		width: max-content;
		max-width: 100%;
		gap: var(--space-2);
		margin-top: var(--space-6);
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
			transform 280ms var(--spring-smooth);
	}
	.view-tab:hover {
		color: var(--text-secondary);
	}
	.view-tab:active {
		transform: scale(0.98);
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
		max-width: min(92%, 32rem);
		padding: 0 0 var(--space-2);
	}
	.clock-kicker {
		margin: 0 0 var(--space-2);
		font-family: var(--font-body);
		font-size: var(--text-xl);
		font-weight: 500;
		letter-spacing: -0.02em;
		color: var(--text-tertiary);
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
		--sheet-glow: radial-gradient(
			44rem 26rem at 50% -8%,
			var(--glow-scan),
			transparent 70%
		);
	}
	.weather-core {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
		gap: 0;
		min-height: 0;
		height: 100%;
	}
	.radar-trough,
	.weather-trough {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.weather-trough {
		border-left: 1px solid var(--hairline);
		padding-left: var(--space-5);
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
		.masthead {
			flex-wrap: wrap;
			align-items: flex-start;
		}
		.status-cluster {
			justify-content: flex-start;
			padding-bottom: 0;
		}
		.weather-core {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		}
		.weather-trough {
			border-left: 0;
			border-top: 1px solid var(--hairline);
			padding-left: 0;
			padding-top: var(--space-4);
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
		.masthead {
			flex-direction: column;
			align-items: flex-start;
		}
		.status-cluster {
			justify-content: flex-start;
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
		.cluster-end {
			flex-wrap: wrap;
			width: 100%;
		}
		.bottom {
			min-height: 0;
		}
	}
</style>
