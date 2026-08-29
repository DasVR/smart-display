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

	let ws;
	let reconnectTimer;
	let transitioning = false;
	let weatherLoading = true;
	let notif = { visible: false, title: '', body: '', kind: 'info' };
	let prevView = 'clock';
	let viewKey = 0;
	let booted = false;

	function showNotif(title, body, kind = 'info', ms = 4000) {
		notif = { visible: true, title, body, kind };
		setTimeout(() => { notif = { ...notif, visible: false }; }, ms);
	}

	function demoIsland() {
		// show the gooey Dynamic Island once on boot so the effect is visible
		setTimeout(() => showNotif('system online', 'ambient display active', 'info', 5000), 800);
	}

	function goTo(view) {
		if (view === $currentView) return;
		prevView = $currentView;
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
		<div class="top-bar">
			<div class="weather-pill">
				{#if weatherLoading}
					<span class="skeleton" style="width:56px;height:14px;display:inline-block"></span>
				{:else}
					{$weather.temp}F - {$weather.desc}
				{/if}
			</div>
			<div class="conn">
				<span class="status-dot" class:ok={$wsStatus === 'connected'}></span>
				<span class="conn-label">{$wsStatus === 'connected' ? 'linked' : 'connecting'}</span>
			</div>
		</div>

		<div class="view-container" class:transitioning>
			{#key viewKey}
				<svelte:component this={views[$currentView]} />
			{/key}
		</div>

		<div class="hint">swipe on your phone to switch views</div>
	</div>
	<NoiseOverlay />
	<GooeyNotification title={notif.title} body={notif.body} kind={notif.kind} visible={notif.visible} />
</div>

<style>
	.display-root {
		width: 100vw;
		height: 100vh;
		background: var(--bg);
		color: var(--text-primary);
		font-family: var(--font-body);
		overflow: hidden;
		position: relative;
		transition: opacity 0.2s ease, filter 0.25s ease;
	}
	.display-root.transitioning { opacity: 0.4; filter: blur(2px); }
	.display-shell {
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		position: relative;
	}
	.display-shell::after {
		content: '';
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 30;
		background: radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.5) 100%);
	}
	.display-root::after { display: none; }
	.top-bar, .hint, .island-wrap {
		/* keep top UI visible during view transitions */
		transition: opacity 0.2s ease;
	}

	.display-root.transitioning .view-container > :global(*) {
		animation: view-out 0.2s var(--ease-enter) forwards;
	}
	@keyframes view-out {
		from { opacity: 1; transform: translateY(0) scale(1); }
		to { opacity: 0; transform: translateY(-10px) scale(0.99); }
	}

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
		background: var(--surface);
		border: 1px solid var(--surface-border);
		border-radius: var(--r-sm);
		padding: 8px 14px;
		font-family: var(--font-display);
		font-size: 13px;
		color: var(--text-secondary);
		letter-spacing: 0.02em;
		min-width: 90px;
	}
	.conn {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.conn-label {
		font-family: var(--font-display);
		font-size: 12px;
		color: var(--text-tertiary);
		letter-spacing: 0.08em;
		text-transform: lowercase;
	}

	.view-container {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.view-container > :global(*) {
		animation: view-in 0.6s var(--ease-enter);
	}
	@keyframes view-in {
		from { opacity: 0; transform: translateY(18px) scale(0.985); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	.hint {
		position: absolute;
		bottom: 22px;
		left: 50%;
		transform: translateX(-50%);
		font-family: var(--font-display);
		font-size: 11px;
		color: var(--text-tertiary);
		letter-spacing: 0.1em;
		text-transform: lowercase;
		pointer-events: none;
	}
</style>
