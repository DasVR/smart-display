<script>
	import { onMount } from 'svelte';
	import { currentView } from '$lib/stores.js';

	let ws;
	let reconnectTimer;
	let touchStartX = 0;
	let touchStartY = 0;
	let connected = false;

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => { connected = true; ws.send(JSON.stringify({ type: 'ping' })); };
		ws.onclose = () => { connected = false; reconnectTimer = setTimeout(connect, 2000); };
	}

	function sendSwipe(dir) {
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'swipe', dir }));
	}

	function handleTouchStart(e) {
		touchStartX = e.changedTouches[0].screenX;
		touchStartY = e.changedTouches[0].screenY;
	}

	function handleTouchEnd(e) {
		const dx = e.changedTouches[0].screenX - touchStartX;
		const dy = e.changedTouches[0].screenY - touchStartY;
		if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
			if (dx < 0) sendSwipe('left');
			else sendSwipe('right');
		}
	}

	onMount(() => {
		connect();
		return () => { clearTimeout(reconnectTimer); ws?.close(); };
	});
</script>

<svelte:head>
	<title>Remote — Smart Display</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
</svelte:head>

<div class="remote-root"
	ontouchstart={handleTouchStart}
	ontouchend={handleTouchEnd}
	role="button"
	tabindex="0"
	aria-label="Swipe to navigate">
	<div class="status-dot" class:connected></div>
	<div class="swipe-hint">
		<div class="arrow left">◀</div>
		<div class="center-text">swipe to navigate</div>
		<div class="arrow right">▶</div>
	</div>
	<div class="current-view">{$currentView}</div>
</div>

<style>
	:global(html, body) { margin: 0; padding: 0; background: #050507; color: #f5f2ec; overflow: hidden; }
	.remote-root {
		width: 100vw; height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 24px;
		font-family: 'Inter', system-ui, sans-serif;
		user-select: none;
		-webkit-user-select: none;
	}
	.status-dot {
		width: 10px; height: 10px;
		border-radius: 50%;
		background: #333;
		transition: background 0.3s;
	}
	.status-dot.connected { background: #00d992; box-shadow: 0 0 8px #00d99240; }
	.swipe-hint {
		display: flex;
		align-items: center;
		gap: 20px;
		color: rgba(255,255,255,0.15);
		font-size: 14px;
		letter-spacing: 0.05em;
	}
	.arrow { font-size: 18px; opacity: 0.4; }
	.current-view {
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		color: rgba(255,255,255,0.12);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin-top: 40px;
	}
</style>
