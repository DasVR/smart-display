<!--
	Hallmark redesign scores
	Philosophy 4 · Hierarchy 4 · Execution 4 · Specificity 4 · Restraint 4 · Variety 4
-->
<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import {
		currentView,
		wsStatus,
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
		setTimeout(() => showNotif('system online', 'ambient display active', 'info', 4200), 700);
		return () => {
			clearInterval(clock);
			clearInterval(music);
			clearTimeout(reconnectTimer);
			stopArbiter?.();
			window.removeEventListener('keydown', onKey);
			ws?.close();
		};
	});
</script>

<div class="display-shell">
	<LiquidMetalCanvas isLowPower={$gpuLowPowerMode} />

	<div class="display-root">
		<header class="zone top">
			<div class="mast-clock">
				<HeroClock {time} />
			</div>
			<div class="mast-dock">
				<DynamicIsland
					nowPlaying={$nowPlaying}
					notification={notif}
					gpuLowPower={$gpuLowPowerMode}
					ollamaStatus={$ollamaStatus}
				/>
			</div>
			<div class="mast-wx">
				<div class="wx-label">Outside</div>
				<div class="wx">
					{#if weatherLoading}
						<span class="skeleton inline"></span>
					{:else}
						<span class="wx-temp num">{$weather.temp}°</span>
						<span class="wx-desc">{$weather.desc}</span>
					{/if}
				</div>
			</div>
		</header>

		<main class="zone center">
			<section class="command-panel paper" class:focus={leftFocus === 'school'}>
				<SchoolHub />
			</section>
			<section class="command-panel paper" class:focus={leftFocus === 'dev'}>
				<DevHub />
			</section>
		</main>

		<footer class="zone bottom">
			<div class="turntable glass-field" data-glass>
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
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 0.9fr);
		align-items: center;
		gap: var(--space-5);
		padding-top: var(--space-4);
		overflow: visible;
	}
	.mast-clock,
	.mast-dock,
	.mast-wx {
		min-width: 0;
	}
	.mast-wx {
		justify-self: end;
		text-align: right;
	}
	.wx-label {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.wx {
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-1);
		flex-wrap: wrap;
	}
	.wx-temp {
		font-size: clamp(2rem, 3vw, 3rem);
		font-weight: 650;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--foreground);
		overflow-wrap: anywhere;
	}
	.wx-desc {
		font-size: 18px;
		color: var(--text-secondary);
	}
	.center {
		height: 55%;
		min-height: 360px;
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		gap: var(--space-5);
		padding-top: var(--space-2);
		padding-bottom: var(--space-2);
	}
	.command-panel {
		position: relative;
		overflow: hidden;
		min-width: 0;
	}
	.command-panel.focus {
		border-color: var(--brand-border);
		box-shadow: inset 3px 0 0 var(--brand);
	}
	.bottom {
		height: 30%;
		min-height: 180px;
		padding-bottom: var(--space-4);
	}
	.turntable {
		width: 100%;
		height: 100%;
		min-width: 0;
	}
	.inline {
		display: inline-block;
		width: 120px;
		height: 28px;
	}

	@media (max-aspect-ratio: 4/3) {
		.top {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			height: 18%;
		}
		.mast-dock {
			grid-column: 1 / -1;
		}
		.center {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 1fr 1fr;
			height: 52%;
		}
	}

	@media (max-width: 768px) {
		.zone {
			padding-inline: var(--space-4);
		}
		.top {
			grid-template-columns: minmax(0, 1fr);
			height: auto;
			min-height: 0;
			padding-top: var(--space-3);
		}
		.mast-wx {
			justify-self: start;
			text-align: left;
		}
		.wx {
			justify-content: flex-start;
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
