<!--
	Hallmark design scores
	Philosophy 5 · Hierarchy 5 · Execution 5 · Specificity 5 · Restraint 4 · Variety 5
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
	import AsciiFrame from '$lib/components/AsciiFrame.svelte';

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
			<div class="masthead">
				<HeroClock {time} />
				<div class="status-cluster">
					<p class="dateline">{weekday}, {month}&nbsp;{dayNum}</p>
					<div class="cluster-end">
						<p class="wxline">
							{#if weatherLoading}
								<span class="skeleton inline"></span>
							{:else}
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
			<nav class="view-strip" aria-label="Views" data-glass>
				{#each VIEWS as v}
					<button
						class="view-tab"
						class:active={$currentView === v}
						onclick={() => currentView.set(v)}
						aria-current={$currentView === v ? 'true' : undefined}
					>
						<span class="view-tab-label">{viewLabel(v)}</span>
					</button>
				{/each}
			</nav>
		</header>

		<main id="main-stage" class="zone center">
			{#if $currentView === 'clock'}
				<section class="view-pane bezel clock-pane">
					<div class="bezel-core clock-core">
						<div class="clock-stage">
							<HeroClock {time} />
							<p class="clock-kicker">{weekday}</p>
						</div>
					</div>
				</section>
			{:else if $currentView === 'school'}
				<section class="view-pane bezel">
					<div class="bezel-core">
						<SchoolHub />
					</div>
				</section>
			{:else if $currentView === 'dev'}
				<section class="view-pane bezel">
					<div class="bezel-core">
						<AsciiFrame tag={$wsStatus === 'connected' ? '[SYS_OK]' : '[LNK_DN]'} ok={$wsStatus === 'connected'}>
							<DevHub />
						</AsciiFrame>
					</div>
				</section>
			{:else if $currentView === 'music'}
				<section class="view-pane bezel">
					<div class="bezel-core">
						<MusicView />
					</div>
				</section>
			{/if}
		</main>

		<footer class="zone bottom">
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
		width: max-content;
		max-width: 100%;
		gap: 0.125rem;
		margin-top: var(--space-6);
		padding: 0.25rem;
		min-width: 0;
		border: 1px solid var(--hairline);
		border-radius: 999px;
		background: var(--shell-fill);
		box-shadow: var(--inset-spec);
		box-sizing: border-box;
	}
	.view-tab {
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--text-tertiary);
		font-family: var(--font-body);
		font-size: var(--text-base);
		font-weight: 600;
		letter-spacing: -0.01em;
		text-transform: none;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition:
			color 280ms var(--spring-smooth),
			background 280ms var(--spring-smooth),
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
		background: color-mix(in srgb, var(--abyss-2) 92%, var(--foreground));
		box-shadow: var(--inset-spec);
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
	.clock-pane {
		min-height: 0;
	}
	.clock-core {
		display: flex;
		align-items: flex-end;
		justify-content: flex-start;
		padding: var(--space-8);
		padding-bottom: var(--space-8);
	}
	.clock-stage {
		min-width: 0;
	}
	.clock-kicker {
		margin: var(--space-4) 0 0;
		font-family: var(--font-body);
		font-size: var(--text-2xl);
		font-weight: 500;
		letter-spacing: -0.03em;
		color: var(--text-tertiary);
	}
	.clock-pane :global(.time) {
		font-size: clamp(80px, 12vw, 180px);
		letter-spacing: -0.06em;
	}
	.clock-pane :global(.seconds),
	.clock-pane :global(.ampm) {
		font-size: 0.35em;
	}
	.bottom {
		height: auto;
		display: flex;
		align-items: flex-end;
		padding-bottom: var(--space-8);
	}
	.trough {
		width: 100%;
		height: 6rem;
		min-width: 0;
		border-radius: var(--radius-bezel);
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
			border-radius: var(--radius-bezel);
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
		.clock-core {
			align-items: flex-start;
			padding: var(--space-6);
		}
		.clock-pane :global(.time) {
			font-size: clamp(2.75rem, 16vw, 5rem);
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
