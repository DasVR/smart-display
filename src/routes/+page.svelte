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
					showNotif('Good morning', 'Briefing ready · check due work', 'info');
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
			<HeroClock {time} />
			<DynamicIsland
				{time}
				weather={$weather}
				nowPlaying={$nowPlaying}
				notification={notif}
				gpuLowPower={$gpuLowPowerMode}
				ollamaStatus={$ollamaStatus}
			/>
			<div class="weather-badge" data-glass>
				<div class="eyebrow">Outside</div>
				<div class="wx">
					{#if weatherLoading}
						<span class="skeleton inline"></span>
					{:else}
						<span class="wx-temp">{$weather.temp}°</span>
						<span class="wx-desc">{$weather.desc}</span>
					{/if}
				</div>
			</div>
		</header>

		<main class="zone center">
			<section class="command-panel glass-panel rounded-2xl border border-white/10 bg-slate-950/40" data-glass class:focus={leftFocus === 'school'}>
				<SchoolHub />
			</section>
			<section class="command-panel glass-panel rounded-2xl border border-white/10 bg-slate-950/40" data-glass class:focus={leftFocus === 'dev'}>
				<DevHub />
			</section>
		</main>

		<footer class="zone bottom">
			<AmbientDeck weather={$weather} />
		</footer>
	</div>

	<NoiseOverlay />
</div>

<style>
	.display-shell {
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		position: relative;
		background: #05060c;
	}
	.display-root {
		position: relative;
		z-index: 10;
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		color: var(--text-primary);
		font-family: var(--font-body);
	}
	.zone {
		width: 100%;
		padding: 0 48px;
		box-sizing: border-box;
	}
	.top {
		height: 15%;
		min-height: 140px;
		display: grid;
		grid-template-columns: 1.1fr 1.2fr 0.9fr;
		align-items: center;
		gap: 24px;
		padding-top: 18px;
		overflow: visible;
	}
	.weather-badge {
		justify-self: end;
		min-width: 180px;
		padding: 14px 18px;
		border-radius: 1.25rem;
		background: rgba(2, 6, 23, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(16px) saturate(1.4);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
	}
	.eyebrow {
		font-size: 11px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: rgb(148, 163, 184);
		font-weight: 500;
	}
	.wx {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin-top: 4px;
	}
	.wx-temp {
		font-size: clamp(2rem, 3vw, 3rem);
		font-weight: 700;
		letter-spacing: -0.04em;
		color: #fff;
	}
	.wx-desc {
		font-size: 18px;
		color: rgb(148, 163, 184);
	}
	.center {
		height: 55%;
		min-height: 360px;
		display: grid;
		grid-template-columns: 1.15fr 1fr;
		gap: 22px;
		padding-top: 8px;
		padding-bottom: 8px;
	}
	.command-panel {
		position: relative;
		overflow: hidden;
		border-radius: 1.25rem;
		background: rgba(2, 6, 23, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(16px) saturate(1.45);
		-webkit-backdrop-filter: blur(16px) saturate(1.45);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 24px 60px rgba(0, 0, 0, 0.35);
	}
	.command-panel::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1px;
		background: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.35),
			rgba(169, 177, 240, 0.18) 40%,
			rgba(255, 255, 255, 0.04) 50%,
			rgba(103, 232, 249, 0.16)
		);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
	}
	.command-panel.focus {
		border-color: rgba(169, 177, 240, 0.38);
	}
	.bottom {
		height: 30%;
		min-height: 180px;
	}
	.inline {
		display: inline-block;
		width: 120px;
		height: 28px;
	}

	@media (max-aspect-ratio: 4/3) {
		.top {
			grid-template-columns: 1fr 1fr;
			height: 18%;
		}
		.center {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr 1fr;
			height: 52%;
		}
		.bottom {
			height: 30%;
		}
	}
</style>
