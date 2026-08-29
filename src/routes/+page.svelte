<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { currentView, wsStatus, weather } from '$lib/stores.js';
	import ClockView from '$lib/components/ClockView.svelte';
	import SchoolView from '$lib/components/SchoolView.svelte';
	import DevView from '$lib/components/DevView.svelte';
	import MusicView from '$lib/components/MusicView.svelte';
	import AmbientShader from '$lib/components/AmbientShader.svelte';
	import GooeyNotification from '$lib/components/GooeyNotification.svelte';
	import NoiseOverlay from '$lib/components/NoiseOverlay.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import AudioZone from '$lib/components/AudioZone.svelte';

	let ws;
	let reconnectTimer;
	let transitioning = false;
	let weatherLoading = true;
	let notif = { visible: false, title: '', body: '', kind: 'info' };
	let viewKey = 0;

	function showNotif(title, body, kind = 'info', ms = 4000) {
		notif = { visible: true, title, body, kind };
		setTimeout(() => { notif = { ...notif, visible: false }; }, ms);
	}

	function demoIsland() {
		setTimeout(() => showNotif('system online', 'ambient display active', 'info', 5000), 800);
	}

	function goTo(view) {
		if (view === $currentView) return;
		transitioning = true;
		setTimeout(() => {
			currentView.set(view);
			viewKey++;
			transitioning = false;
		}, 180);
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
					goTo(msg.view);
				}
				if (msg.type === 'trigger' && msg.event === 'morning') {
					showNotif('Good morning', 'AP Gov deadline today', 'info');
					goTo('school');
				}
				if (msg.type === 'power') {
					window.dispatchEvent(new CustomEvent('power-state', { detail: msg.state }));
				}
			} catch {}
		};
	}

	onMount(() => {
		connect();
		fetchWeather();
		demoIsland();
		return () => { clearTimeout(reconnectTimer); ws?.close(); };
	});

	async function fetchWeather() {
		weatherLoading = true;
		try {
			const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=27.9&longitude=-82.4&current_weather=true');
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

	const views = {
		clock: ClockView,
		school: SchoolView,
		dev: DevView,
		music: MusicView
	};
</script>

<div class="display-shell">
	<AmbientShader />
	<div class="display-root" class:transitioning>
		<div class="zone top">
			<div class="top-left">
				<div class="clock-mini">
					<ClockView compact />
				</div>
				<div class="weather-pill">
					{#if weatherLoading}
						<span class="skeleton" style="width:90px;height:24px;display:inline-block"></span>
					{:else}
						{$weather.temp}°F · {$weather.desc}
					{/if}
				</div>
			</div>
			<div class="top-right">
				<GooeyNotification title={notif.title} body={notif.body} kind={notif.kind} visible={notif.visible} />
			</div>
		</div>

		<div class="zone center">
			<div class="panel left-panel">
				{#key viewKey}
					{#if $currentView === 'dev'}
						<DevView />
					{:else}
						<SchoolView />
					{/if}
				{/key}
			</div>
			<div class="panel right-panel">
				{#if $currentView === 'music'}
					<MusicView />
				{:else}
					<!-- Infrastructure / Agent grid -->
					<TopBar />
				{/if}
			</div>
		</div>

		<div class="zone bottom">
			<AudioZone />
		</div>
	</div>
	<NoiseOverlay />
</div>

<style>
	.display-shell {
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		position: relative;
		background: var(--bg);
	}
	.display-root {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		color: var(--text-primary);
		font-family: var(--font-body);
		position: relative;
		z-index: 10;
		transition: opacity 0.2s ease, filter 0.25s ease;
	}
	.display-root.transitioning { opacity: 0.4; filter: blur(2px); }

	.zone {
		width: 100%;
		padding: 0 56px;
		box-sizing: border-box;
		position: relative;
	}

	.top {
		height: 20%;
		min-height: 160px;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding-top: 32px;
	}
	.top-left {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.clock-mini {
		width: 280px;
		height: 90px;
		overflow: hidden;
		--clock-scale: 0.35;
	}
	.weather-pill {
		background: var(--surface);
		border: 1px solid var(--surface-border);
		border-radius: var(--r-sm);
		padding: 14px 22px;
		font-family: var(--font-display);
		font-size: 22px;
		color: var(--text-secondary);
		letter-spacing: 0.02em;
	}
	.top-right {
		display: flex;
		justify-content: flex-end;
		align-items: flex-start;
	}

	.center {
		height: 50%;
		min-height: 400px;
		display: grid;
		grid-template-columns: 1.3fr 1fr;
		gap: 32px;
		padding-top: 10px;
		padding-bottom: 10px;
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--surface-border);
		border-radius: var(--r-lg);
		backdrop-filter: blur(10px) saturate(1.3);
		-webkit-backdrop-filter: blur(10px) saturate(1.3);
		overflow: hidden;
		position: relative;
	}
	.panel::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1px;
		background: linear-gradient(135deg, rgba(169,177,240,0.18), rgba(255,255,255,0.04) 50%, rgba(169,177,240,0.06));
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
	}

	.bottom {
		height: 30%;
		min-height: 200px;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding-bottom: 28px;
		pointer-events: none;
	}

	:global(.skeleton) {
		background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 100%);
		background-size: 200% 100%;
		border-radius: var(--r-sm);
		animation: shimmer 1.6s infinite;
	}
	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	@media (max-aspect-ratio: 4/3) {
		.center { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; height: 60%; }
		.top { height: 15%; min-height: 120px; }
		.bottom { height: 25%; min-height: 140px; }
	}
</style>
