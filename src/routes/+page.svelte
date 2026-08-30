<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 5 · Restraint 4 · Variety 4
-->
<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { currentView, weather, nowPlaying, wsStatus } from '$lib/stores.js';
	import { gpuLowPowerMode, ollamaStatus, startOllamaArbiter, toggleGpuLowPower } from '$lib/services/ollamaArbiter.js';
	import LiquidMetalCanvas from '$lib/shaders/LiquidMetalCanvas.svelte';
	import DynamicIsland from '$lib/components/DynamicIsland.svelte';
	import HeroClock from '$lib/components/HeroClock.svelte';
	import SchoolHub from '$lib/components/SchoolHub.svelte';
	import DevHub from '$lib/components/DevHub.svelte';
	import AmbientDeck from '$lib/components/AmbientDeck.svelte';
	import NoiseOverlay from '$lib/components/NoiseOverlay.svelte';
	import AsciiFrame from '$lib/components/AsciiFrame.svelte';

	let ws;
	let reconnectTimer;
	let time = $state(new Date());
	let weatherLoading = $state(true);
	let notif = $state({ visible: false, title: '', body: '', kind: 'info' });
	let leftFocus = $state('school');

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
					if (msg.view === 'school') leftFocus = 'school';
					if (msg.view === 'dev') leftFocus = 'dev';
				}
				if (msg.type === 'trigger' && msg.event === 'morning') {
					showNotif('Good morning', 'Briefing ready. Check due work.', 'info');
					leftFocus = 'school';
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

	onMount(() => {
		connect();
		fetchWeather();
		fetchNowPlaying();
		const clock = setInterval(() => {
			time = new Date();
		}, 1000);
		const music = setInterval(fetchNowPlaying, 4000);
		const stopArbiter = startOllamaArbiter();
		const onKey = (e) => {
			if (e.altKey && (e.key === 'y' || e.key === 'Y')) {
				toggleGpuLowPower();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			clearInterval(clock);
			clearInterval(music);
			clearTimeout(reconnectTimer);
			stopArbiter?.();
			window.removeEventListener('keydown', onKey);
			ws?.close();
		};
	});

	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' }));
	let dayNum = $derived(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDate());
</script>

<div class="display-shell">
	<LiquidMetalCanvas isLowPower={$gpuLowPowerMode} />

	<div class="display-root">
		<header class="zone top">
			<div class="masthead">
				<HeroClock {time} />
				<div class="status-cluster">
					<p class="dateline">{weekday}, {month} {dayNum}</p>
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
		</header>

		<main class="zone center">
			<section class="school-col" class:focus={leftFocus === 'school'}>
				<SchoolHub />
			</section>
			<section class="host-slab slab" class:focus={leftFocus === 'dev'} data-glass>
				<AsciiFrame tag={$wsStatus === 'connected' ? '[SYS_OK]' : '[LNK_DN]'} ok={$wsStatus === 'connected'}>
					<DevHub />
				</AsciiFrame>
			</section>
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
	.display-shell {
		width: 100vw;
		height: 100vh;
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
		font-family: var(--font-display);
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
		padding-top: var(--space-4);
		padding-bottom: var(--space-2);
		overflow: visible;
	}
	.masthead {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		width: 100%;
		min-width: 0;
	}
	.status-cluster {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
		padding-bottom: var(--space-2);
	}
	.cluster-end {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		min-width: 0;
	}
	.dateline,
	.wxline {
		margin: 0;
		font-size: 16px;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
		min-width: 0;
		line-height: 1.2;
	}
	.wxline .num {
		margin-right: var(--space-2);
		color: var(--foreground);
	}
	.center {
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-6);
		padding-top: var(--space-4);
		padding-bottom: var(--space-4);
	}
	.school-col {
		position: relative;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
		min-height: 0;
		height: 100%;
	}
	.school-col :global(.school-hub) {
		flex: 1;
		height: 100%;
	}
	.school-col.focus {
		box-shadow: inset 2px 0 0 var(--brand);
	}
	.host-slab {
		position: relative;
		overflow: hidden;
		min-width: 0;
		min-height: 0;
		height: 100%;
	}
	.host-slab.focus {
		border-color: var(--brand-border);
	}
	.bottom {
		height: auto;
		display: flex;
		align-items: flex-end;
		padding-bottom: var(--space-4);
	}
	.trough {
		width: 100%;
		height: 80px;
		min-width: 0;
	}
	.inline {
		display: inline-block;
		width: 96px;
		height: 16px;
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
		.center {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(240px, 1fr) minmax(240px, 1fr);
		}
	}

	@media (max-width: 768px) {
		.display-shell {
			height: auto;
			min-height: 100vh;
			overflow-y: visible;
		}
		.display-root {
			height: auto;
			min-height: 100vh;
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
		.center {
			grid-template-columns: minmax(0, 1fr);
			height: auto;
			min-height: 0;
		}
		.school-col,
		.host-slab {
			min-height: 320px;
		}
		.bottom {
			min-height: 0;
		}
	}
</style>
