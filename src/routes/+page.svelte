<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 4 · Execution 4 · Specificity 4 · Restraint 4 · Variety 4
-->
<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import {
		currentView,
		weather,
		nowPlaying
	} from '$lib/stores.js';
	import { gpuLowPowerMode, ollamaStatus, startOllamaArbiter, toggleGpuLowPower } from '$lib/services/ollamaArbiter.js';
	import LiquidMetalCanvas from '$lib/shaders/LiquidMetalCanvas.svelte';
	import DynamicIsland from '$lib/components/DynamicIsland.svelte';
	import HeroClock from '$lib/components/HeroClock.svelte';
	import SchoolHub from '$lib/components/SchoolHub.svelte';
	import DevHub from '$lib/components/DevHub.svelte';
	import AmbientDeck from '$lib/components/AmbientDeck.svelte';
	import NoiseOverlay from '$lib/components/NoiseOverlay.svelte';

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
				'https://api.open-meteo.com/v1/forecast?latitude=27.9&longitude=-82.4&current_weather=true&temperature_unit=fahrenheit'
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

	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long' }));
	let dayNum = $derived(time.getDate());
</script>

<div class="display-shell">
	<LiquidMetalCanvas isLowPower={$gpuLowPowerMode} />

	<div class="display-root">
		<header class="zone top">
			<HeroClock {time} />
			<div class="mast-rail">
				<p class="dateline">{weekday}, {month} {dayNum}</p>
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
		</header>

		<main class="zone center">
			<section class="school-col" class:focus={leftFocus === 'school'}>
				<SchoolHub />
			</section>
			<section class="host-slab slab" class:focus={leftFocus === 'dev'} data-glass>
				<DevHub />
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
		display: flex;
		flex-direction: column;
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
		height: 15%;
		min-height: 140px;
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		align-items: end;
		gap: var(--space-5);
		padding-top: var(--space-4);
		overflow: visible;
	}
	.mast-rail {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: flex-end;
		gap: var(--space-1);
		min-width: 0;
		text-align: right;
	}
	.dateline,
	.wxline {
		margin: 0;
		font-size: 16px;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.wxline .num {
		margin-right: 0.35em;
		color: var(--foreground);
	}
	.center {
		height: 55%;
		min-height: 360px;
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.85fr);
		gap: var(--space-6);
		padding-top: var(--space-3);
		padding-bottom: var(--space-2);
	}
	.school-col {
		position: relative;
		overflow: hidden;
		min-width: 0;
		padding-left: var(--space-3);
	}
	.school-col.focus {
		box-shadow: inset 3px 0 0 var(--brand);
	}
	.host-slab {
		position: relative;
		overflow: hidden;
		min-width: 0;
	}
	.host-slab.focus {
		border-color: var(--brand-border);
	}
	.bottom {
		height: 30%;
		min-height: 180px;
		display: flex;
		align-items: flex-end;
		padding-bottom: var(--space-4);
	}
	.trough {
		width: 100%;
		height: 38%;
		min-height: 72px;
		min-width: 0;
	}
	.inline {
		display: inline-block;
		width: 96px;
		height: 18px;
	}

	@media (max-aspect-ratio: 4/3) {
		.top {
			grid-template-columns: minmax(0, 1fr);
			height: 18%;
		}
		.mast-rail {
			align-items: flex-start;
			text-align: left;
		}
		.center {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 1fr 1fr;
			height: 52%;
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
		}
		.zone {
			padding-inline: var(--space-4);
		}
		.top {
			grid-template-columns: minmax(0, 1fr);
			height: auto;
			min-height: 0;
			padding-top: var(--space-3);
			align-items: start;
		}
		.mast-rail {
			align-items: flex-start;
			text-align: left;
		}
		.center {
			grid-template-columns: minmax(0, 1fr);
			height: auto;
			min-height: 0;
		}
		.bottom {
			min-height: 140px;
		}
	}
</style>
