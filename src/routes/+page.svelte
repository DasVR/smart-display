<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { currentView, wsStatus, weather, nowPlaying } from '$lib/stores.js';
	import ClockView from '$lib/components/ClockView.svelte';
	import SchoolView from '$lib/components/SchoolView.svelte';
	import DevView from '$lib/components/DevView.svelte';
	import MusicView from '$lib/components/MusicView.svelte';

	let ws;
	let reconnectTimer;
	let transitioning = false;

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => wsStatus.set('connected');
		ws.onclose = () => { wsStatus.set('disconnected'); reconnectTimer = setTimeout(connect, 2000); };
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === 'navigate') {
					transitioning = true;
					setTimeout(() => { currentView.set(msg.view); transitioning = false; }, 150);
				}
				if (msg.type === 'trigger' && msg.event === 'morning') {
					transitioning = true;
					setTimeout(() => { currentView.set('school'); transitioning = false; }, 150);
				}
			} catch {}
		};
	}

	onMount(() => {
		connect();
		fetchWeather();
		return () => { clearTimeout(reconnectTimer); ws?.close(); };
	});

	async function fetchWeather() {
		try {
			const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=27.9&longitude=-82.4&current_weather=true');
			const d = await r.json();
			weather.set({ temp: Math.round(d.current_weather.temperature), desc: d.current_weather.weathercode, icon: weatherIcon(d.current_weather.weathercode) });
			setTimeout(fetchWeather, 600000);
		} catch { setTimeout(fetchWeather, 30000); }
	}

	function weatherIcon(code) {
		if (code <= 1) return '☀️';
		if (code <= 3) return '⛅';
		if (code <= 48) return '🌫️';
		if (code <= 67) return '🌧️';
		if (code <= 77) return '❄️';
		if (code <= 82) return '🌧️';
		if (code <= 86) return '❄️';
		if (code <= 99) return '⛈️';
		return '☁️';
	}

	const views = {
		clock: ClockView,
		school: SchoolView,
		dev: DevView,
		music: MusicView
	};
</script>

<div class="display-root" class:transitioning>
	<div class="top-bar">
		<div class="weather-pill">{$weather.icon} {$weather.temp}°F</div>
		<div class="connection-dot" class:connected={$wsStatus === 'connected'}></div>
	</div>

	<div class="view-container">
		<svelte:component this={views[$currentView]} />
	</div>

	<div class="bottom-hint">
		⬅️ swipe on your phone ➡️
	</div>
</div>

<style>
	.display-root {
		width: 100vw;
		height: 100vh;
		background: #050507;
		color: #f5f2ec;
		font-family: 'Inter', system-ui, sans-serif;
		overflow: hidden;
		position: relative;
		transition: opacity 0.15s ease;
	}
	.display-root.transitioning { opacity: 0.3; }

	.top-bar {
		position: absolute;
		top: 24px;
		left: 0; right: 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 40px;
		z-index: 100;
		pointer-events: none;
	}
	.weather-pill {
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 999px;
		padding: 8px 16px;
		font-size: 14px;
		font-weight: 500;
		font-family: 'JetBrains Mono', monospace;
		letter-spacing: -0.02em;
	}
	.connection-dot {
		width: 8px; height: 8px;
		border-radius: 50%;
		background: #444;
		transition: background 0.3s;
	}
	.connection-dot.connected { background: #00d992; box-shadow: 0 0 6px #00d99240; }

	.view-container {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.bottom-hint {
		position: absolute;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 12px;
		color: rgba(255,255,255,0.15);
		font-family: 'JetBrains Mono', monospace;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		pointer-events: none;
	}
</style>
