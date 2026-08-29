<script>
	import { onMount } from 'svelte';
	import { currentView } from '$lib/stores.js';

	let ws;
	let reconnectTimer;
	let connected = false;
	let current = 'clock';

	const unsub = currentView.subscribe(v => { current = v; });

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => {
			connected = true;
			ws.send(JSON.stringify({ type: 'ping' }));
		};
		ws.onclose = () => {
			connected = false;
			reconnectTimer = setTimeout(connect, 1500);
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === 'init' || msg.type === 'navigate') {
					currentView.set(msg.view);
				}
			} catch {}
		};
	}

	function sendSwipe(dir) {
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'swipe', dir }));
	}

	let touchStartX = 0;
	function handleTouchStart(e) {
		touchStartX = e.changedTouches[0].screenX;
	}
	function handleTouchEnd(e) {
		const dx = e.changedTouches[0].screenX - touchStartX;
		if (Math.abs(dx) > 30) {
			sendSwipe(dx < 0 ? 'left' : 'right');
		}
	}

	let mouseStartX = 0;
	let mouseDown = false;
	function handleMouseDown(e) {
		mouseDown = true;
		mouseStartX = e.screenX;
	}
	function handleMouseUp(e) {
		if (!mouseDown) return;
		mouseDown = false;
		const dx = e.screenX - mouseStartX;
		if (Math.abs(dx) > 30) {
			sendSwipe(dx < 0 ? 'left' : 'right');
		}
	}
	function handleMouseLeave() { mouseDown = false; }

	function handleKey(e) {
		if (e.key === 'ArrowRight') sendSwipe('left');
		if (e.key === 'ArrowLeft') sendSwipe('right');
	}

	onMount(() => {
		connect();
		return () => { clearTimeout(reconnectTimer); ws?.close(); unsub(); };
	});
</script>

<svelte:head>
	<title>Remote — Smart Display</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover">
</svelte:head>

<svelte:window onkeydown={handleKey} />

<div
	class="remote-root"
	ontouchstart={handleTouchStart}
	ontouchend={handleTouchEnd}
	onmousedown={handleMouseDown}
	onmouseup={handleMouseUp}
	onmouseleave={handleMouseLeave}
	role="button"
	tabindex="0"
	aria-label="Swipe, drag, or tap to navigate">
	<div class="status-dot" class:connected></div>

	<div class="nav-zone">
		<button class="nav-btn left" onclick={() => sendSwipe('right')} aria-label="previous view">◀</button>
		<div class="center">
			<div class="hint">swipe or drag</div>
			<div class="current-view">{current}</div>
		</div>
		<button class="nav-btn right" onclick={() => sendSwipe('left')} aria-label="next view">▶</button>
	</div>

	<div class="views-row">
		{#each ['clock','school','dev','music'] as v}
			<button
				class="view-pill"
				class:active={v === current}
				onclick={() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'navigate', view: v })); }}
				aria-label={`go to ${v}`}
			>
				{v}
			</button>
		{/each}
	</div>
</div>

<style>
	:global(html, body) { margin: 0; padding: 0; background: #050507; color: #f5f2ec; overflow: hidden; }
	.remote-root {
		width: 100vw; height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 28px;
		font-family: 'Inter', system-ui, sans-serif;
		user-select: none;
		-webkit-user-select: none;
	}
	.status-dot {
		width: 12px; height: 12px;
		border-radius: 50%;
		background: rgba(255,255,255,0.15);
		transition: background 0.3s;
	}
	.status-dot.connected { background: #00d992; box-shadow: 0 0 10px rgba(0,217,146,0.5); }

	.nav-zone {
		display: flex;
		align-items: center;
		gap: 30px;
	}
	.nav-btn {
		width: 72px; height: 72px;
		border-radius: 50%;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.10);
		color: rgba(255,255,255,0.6);
		font-size: 22px;
		display: flex; align-items: center; justify-content: center;
		cursor: pointer;
		transition: transform 0.15s, background 0.2s;
	}
	.nav-btn:active { transform: scale(0.92); background: rgba(255,255,255,0.12); }

	.center { text-align: center; }
	.hint { font-size: 12px; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase; }
	.current-view {
		font-family: 'JetBrains Mono', monospace;
		font-size: 18px;
		color: rgba(255,255,255,0.6);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		margin-top: 8px;
	}

	.views-row {
		display: flex;
		gap: 10px;
		margin-top: 10px;
	}
	.view-pill {
		padding: 8px 14px;
		border-radius: 999px;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.08);
		color: rgba(255,255,255,0.4);
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: pointer;
	}
	.view-pill.active {
		background: rgba(169,177,240,0.16);
		border-color: rgba(169,177,240,0.4);
		color: rgba(242,240,247,0.9);
	}
</style>
