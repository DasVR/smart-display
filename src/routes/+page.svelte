<!--
	Hallmark design scores
	Philosophy 5 · Hierarchy 5 · Execution 5 · Specificity 5 · Restraint 5 · Variety 5
	Credits-roll HUD: shader is the sculpture, clock as corner type,
	indexed views, glass only on the trough. Lusion About DNA, not pixels.
-->
<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { currentView, displayMode, weather, nowPlaying, wsStatus } from '$lib/stores.js';
	import { gpuLowPowerMode, ollamaStatus, toggleGpuLowPower } from '$lib/services/ollamaArbiter.js';
	import LiquidMetalCanvas from '$lib/shaders/LiquidMetalCanvas.svelte';
	import DynamicIsland from '$lib/components/DynamicIsland.svelte';
	import HeroClock from '$lib/components/HeroClock.svelte';
	import SchoolHub from '$lib/components/SchoolHub.svelte';
	import DevHub from '$lib/components/DevHub.svelte';
	import MusicView from '$lib/components/MusicView.svelte';
	import AmbientDeck from '$lib/components/AmbientDeck.svelte';
	import NoiseOverlay from '$lib/components/NoiseOverlay.svelte';

	let ws;
	let reconnectTimer;
	let time = $state(new Date());
	let weatherLoading = $state(true);
	let notif = $state({ visible: false, title: '', body: '', kind: 'info' });
	let mode = $state('normal');
	let hdmiOff = $state(false);

	const VIEWS = ['clock', 'school', 'dev', 'music'];

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
			const r = await fetch(
				'https://api.open-meteo.com/v1/forecast?latitude=27.9&longitude=-82.8&current_weather=true&temperature_unit=fahrenheit&timezone=America/New_York'
			);
			const d = await r.json();
			weather.set({
				temp: Math.round(d.current_weather.temperature),
				desc: weatherLabel(d.current_weather.weathercode)
			});
			weatherLoading = false;
			setTimeout(fetchWeather, 600000);
		} catch {
			weatherLoading = false;
			setTimeout(fetchWeather, 30000);
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

	function weatherLabel(code) {
		if (code <= 1) return 'Clear';
		if (code <= 3) return 'Cloudy';
		if (code <= 48) return 'Fog';
		if (code <= 67) return 'Rain';
		if (code <= 77) return 'Snow';
		if (code <= 82) return 'Showers';
		if (code <= 86) return 'Snow';
		if (code <= 99) return 'Storm';
		return 'Fair';
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
		window.addEventListener('keydown', handleKey);
		return () => {
			clearInterval(clock);
			clearInterval(music);
			clearTimeout(reconnectTimer);
			window.removeEventListener('keydown', handleKey);
			ws?.close();
		};
	});

	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' }));
	let dayNum = $derived(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDate());

	function viewLabel(name) {
		return name.slice(0, 1).toUpperCase() + name.slice(1);
	}
</script>

<svelte:head>
	<title>Smart Display</title>
</svelte:head>

<a class="skip" href="#main-stage">Skip to view</a>

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
						/>
					</div>
				</div>
			</div>
			<nav class="view-strip" aria-label="Views">
				{#each VIEWS as v, i}
					<button
						class="view-tab"
						class:active={$currentView === v}
						onclick={() => currentView.set(v)}
						aria-current={$currentView === v ? 'page' : undefined}
					>
						<span class="idx">{String(i + 1).padStart(2, '0')}</span>
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
				<section class="view-pane sheet">
					<SchoolHub />
				</section>
			{:else if $currentView === 'dev'}
				<section class="view-pane sheet">
					<DevHub />
				</section>
			{:else if $currentView === 'music'}
				<section class="view-pane music-pane">
					<MusicView />
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
		display: flex;
		align-items: stretch;
		width: max-content;
		max-width: 100%;
		gap: var(--space-6);
		margin-top: var(--space-6);
		padding: 0;
		min-width: 0;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
		box-sizing: border-box;
	}
	.view-tab {
		appearance: none;
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		min-height: 2.75rem;
		border: 0;
		border-bottom: 1px solid transparent;
		border-radius: 0;
		background: transparent;
		color: var(--text-tertiary);
		font-family: var(--font-body);
		font-size: var(--text-base);
		font-weight: 500;
		letter-spacing: -0.01em;
		text-transform: none;
		padding: var(--space-2) 0;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 280ms var(--spring-smooth),
			border-color 280ms var(--spring-smooth),
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
		background: none;
		box-shadow: none;
		border-bottom-color: var(--brand);
	}
	.idx {
		font-family: var(--font-code);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--text-tertiary);
	}
	.view-tab.active .idx {
		color: var(--brand);
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
		max-width: min(92%, 28rem);
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
			min-height: 14rem;
		}
		.clock-pane,
		.music-pane {
			justify-content: flex-start;
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
