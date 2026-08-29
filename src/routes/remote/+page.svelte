<script>
	import { onMount } from 'svelte';
	import { currentView } from '$lib/stores.js';

	let ws;
	let reconnectTimer;
	let connected = false;
	let current = 'clock';
	let lastSent = '-';
	const unsub = currentView.subscribe(v => { current = v; });

	function connect() {
		const host = location.host;
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${host}/ws`;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			lastSent = 'ws err: ' + e.message;
			return;
		}
		ws.onopen = () => {
			connected = true;
			lastSent = 'connected';
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

	function send(obj) {
		if (!ws || ws.readyState !== 1) {
			lastSent = 'not connected';
			return;
		}
		const txt = JSON.stringify(obj);
		ws.send(txt);
		lastSent = 'sent ' + obj.type;
	}

	function go(v) {
		send({ type: 'navigate', view: v });
	}

	let touchStartX = 0;
	function handleTouchStart(e) {
		touchStartX = e.changedTouches[0].screenX;
	}
	function handleTouchEnd(e) {
		const dx = e.changedTouches[0].screenX - touchStartX;
		if (Math.abs(dx) > 40) {
			send({ type: 'swipe', dir: dx < 0 ? 'left' : 'right' });
		}
	}

	function handleKey(e) {
		if (e.key === 'ArrowRight') send({ type: 'swipe', dir: 'left' });
		if (e.key === 'ArrowLeft') send({ type: 'swipe', dir: 'right' });
	}

	onMount(() => {
		connect();
		return () => { clearTimeout(reconnectTimer); ws?.close(); unsub(); };
	});
</script>

<svelte:head>
	<title>Remote — Smart Display</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
</svelte:head>

<svelte:window onkeydown={handleKey} />

<div class="remote-root">
	<div class="status-row">
		<div class="status-dot" class:connected></div>
		<div class="debug">{lastSent} · {current}</div>
	</div>

	<div class="nav-zone">
		<button type="button" class="nav-btn" onclick={() => send({ type: 'swipe', dir: 'right' })} aria-label="previous view">◀</button>
		<div class="center">
			<div class="hint">tap arrows to switch</div>
			<div class="current-view">{current}</div>
		</div>
		<button type="button" class="nav-btn" onclick={() => send({ type: 'swipe', dir: 'left' })} aria-label="next view">▶</button>
	</div>

	<div class="views-row">
		{#each ['clock','school','dev','music'] as v}
			<button
				type="button"
				class="view-pill"
				class:active={v === current}
				onclick={() => go(v)}
				onpointerdown={(e) => { e.preventDefault(); go(v); }}
			>
				{v}
			</button>
		{/each}
	</div>

	<div class="gesture-hint" ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
		or swipe here
	</div>
</div>

<style>
	:global(html, body) { margin: 0; padding: 0; background: #050507; color: #f5f2ec; overflow: hidden; }
	.remote-root {
		width: 100vw; height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 32px;
		font-family: 'Inter', system-ui, sans-serif;
		user-select: none; -webkit-user-select: none;
	}
	.status-row { display: flex; align-items: center; gap: 10px; }
	.status-dot {
		width: 12px; height: 12px;
		border-radius: 50%;
		background: rgba(255,255,255,0.15);
		transition: background 0.3s;
	}
	.status-dot.connected { background: #00d992; box-shadow: 0 0 10px rgba(0,217,146,0.5); }
	.debug { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: rgba(255,255,255,0.25); }

	.nav-zone {
		display: flex;
		align-items: center;
		gap: 30px;
	}
	.nav-btn {
		width: 84px; height: 84px;
		border-radius: 50%;
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.12);
		color: rgba(255,255,255,0.7);
		font-size: 26px;
		display: flex; align-items: center; justify-content: center;
		cursor: pointer;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
		transition: transform 0.1s, background 0.2s;
	}
	.nav-btn:active { transform: scale(0.92); background: rgba(255,255,255,0.14); }

	.center { text-align: center; }
	.hint { font-size: 13px; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase; }
	.current-view {
		font-family: 'JetBrains Mono', monospace; font-size: 20px;
		color: rgba(255,255,255,0.65); letter-spacing: 0.12em;
		text-transform: uppercase; margin-top: 8px;
	}

	.views-row { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
	.view-pill {
		padding: 12px 18px;
		border-radius: 999px;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.08);
		color: rgba(255,255,255,0.45);
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase;
		cursor: pointer; touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
		transition: transform 0.1s, background 0.2s;
	}
	.view-pill:active { transform: scale(0.96); }
	.view-pill.active {
		background: rgba(169,177,240,0.18);
		border-color: rgba(169,177,240,0.45);
		color: rgba(242,240,247,0.95);
	}

	.gesture-hint {
		margin-top: 20px; padding: 14px 24px;
		border-radius: 999px;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		font-size: 12px; color: rgba(255,255,255,0.25);
		letter-spacing: 0.08em; text-transform: uppercase;
	}
</style>
