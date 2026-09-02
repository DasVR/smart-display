<script>
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';

	const current = writable('clock');
	const views = ['clock', 'school', 'dev', 'music'];

	let ws = $state(null);
	let status = $state('connecting');
	let lastAction = $state('');
	let host = $state('');

	function pickHost() {
		const h = location.host;
		if (h) return h;
		return '100.104.181.43:3000';
	}

	function connect() {
		if (ws) { try { ws.close(); } catch {} }
		status = 'connecting';
		host = pickHost();
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${host}/ws`;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			status = 'error';
			lastAction = e.message;
			setTimeout(connect, 2000);
			return;
		}
		ws.onopen = () => {
			status = 'connected';
			lastAction = 'connected';
			ws.send(JSON.stringify({ type: 'ping' }));
		};
		ws.onclose = () => {
			status = 'disconnected';
			setTimeout(connect, 1500);
		};
		ws.onerror = () => {
			status = 'error';
			lastAction = 'ws error';
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === 'init' || msg.type === 'navigate') {
					current.set(msg.view || 'clock');
				}
				if (msg.type === 'pong') {
					status = 'connected';
				}
			} catch {}
		};
	}

	function send(obj) {
		if (!ws || ws.readyState !== 1) {
			lastAction = 'not connected';
			return;
		}
		ws.send(JSON.stringify(obj));
		lastAction = obj.type + (obj.view ? ` ${obj.view}` : obj.dir ? ` ${obj.dir}` : '');
		if (navigator.vibrate) navigator.vibrate(12);
	}

	function go(view) {
		send({ type: 'navigate', view });
	}

	function next() { send({ type: 'swipe', dir: 'left' }); }
	function prev() { send({ type: 'swipe', dir: 'right' }); }

	let touchStartX = 0;
	let touchStartY = 0;
	function touchStart(e) {
		touchStartX = e.changedTouches[0].screenX;
		touchStartY = e.changedTouches[0].screenY;
	}
	function touchEnd(e) {
		const dx = e.changedTouches[0].screenX - touchStartX;
		const dy = e.changedTouches[0].screenY - touchStartY;
		if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
			send({ type: 'swipe', dir: dx < 0 ? 'left' : 'right' });
		}
	}

	function keydown(e) {
		if (e.key === 'ArrowRight') next();
		if (e.key === 'ArrowLeft') prev();
	}

	onMount(() => {
		connect();
		const ping = setInterval(() => {
			if (status === 'connected' && ws?.readyState === 1) {
				ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, 5000);
		return () => { clearInterval(ping); ws?.close(); };
	});
</script>

<svelte:head>
	<title>Remote — Smart Display</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
	<meta name="theme-color" content="#050507">
</svelte:head>

<svelte:window onkeydown={keydown} />

<div
	class="remote"
	role="application"
	aria-label="Smart display remote"
	ontouchstart={touchStart}
	ontouchend={touchEnd}
>
	<div class="top">
		<div class="status" class:connected={status === 'connected'} class:error={status === 'error'}>
			<span class="dot"></span>
			<span class="label">{status}</span>
		</div>
		<div class="host">{host || 'finding...'}</div>
	</div>

	<div class="hero">
		<button class="arrow" aria-label="previous" onclick={prev}>‹</button>
		<div class="current">
			<div class="current-label">now showing</div>
			<div class="current-name">{$current}</div>
		</div>
		<button class="arrow" aria-label="next" onclick={next}>›</button>
	</div>

	<div class="pills" role="tablist" aria-label="Views">
		{#each views as v}
			<button
				class="pill"
				class:active={v === $current}
				onclick={() => go(v)}
				role="tab"
				aria-selected={v === $current}
				aria-label={`show ${v}`}
			>
				{v}
			</button>
		{/each}
	</div>

	<div class="modes">
		<button class="mode" onclick={() => send({ type: 'trigger', event: 'sleep' })}>sleep</button>
		<button class="mode" onclick={() => send({ type: 'trigger', event: 'normal' })}>normal</button>
		<button class="mode warn" onclick={() => send({ type: 'trigger', event: 'hdmi_off' })}>hdmi off</button>
		<button class="mode" onclick={() => send({ type: 'trigger', event: 'hdmi_on' })}>hdmi on</button>
	</div>

	{#if lastAction}
		<div class="last">{lastAction}</div>
	{/if}

	<div class="hint">swipe anywhere to switch</div>
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: #050507;
		color: #f5f2ec;
		font-family: 'Inter', system-ui, -apple-system, sans-serif;
		overflow: hidden;
		-webkit-tap-highlight-color: transparent;
	}
	.remote {
		width: 100vw;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		padding: 24px 20px max(24px, env(safe-area-inset-bottom));
		box-sizing: border-box;
		user-select: none;
		-webkit-user-select: none;
	}
	.top {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(255,255,255,0.35);
	}
	.status.connected { color: #00d992; }
	.status.error { color: #fe6f69; }
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgba(255,255,255,0.25);
	}
	.status.connected .dot { background: #00d992; box-shadow: 0 0 10px #00d992; }
	.status.error .dot { background: #fe6f69; }
	.host {
		font-size: 11px;
		font-family: 'JetBrains Mono', monospace;
		color: rgba(255,255,255,0.18);
	}

	.hero {
		display: flex;
		align-items: center;
		gap: 24px;
		width: 100%;
		justify-content: center;
	}
	.arrow {
		width: 88px;
		height: 88px;
		border-radius: 50%;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.05);
		color: rgba(255,255,255,0.7);
		font-size: 42px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 0.08s, background 0.15s;
	}
	.arrow:active { transform: scale(0.92); background: rgba(255,255,255,0.14); }
	.current {
		text-align: center;
		min-width: 120px;
	}
	.current-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: rgba(255,255,255,0.25);
		margin-bottom: 8px;
	}
	.current-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 28px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #a9b1f0;
	}

	.pills {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.pill {
		padding: 12px 20px;
		border-radius: 999px;
		border: 1px solid rgba(255,255,255,0.08);
		background: rgba(255,255,255,0.03);
		color: rgba(255,255,255,0.45);
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 0.08s, background 0.15s, border-color 0.15s;
	}
	.pill:active { transform: scale(0.96); }
	.pill.active {
		background: rgba(169,177,240,0.16);
		border-color: rgba(169,177,240,0.45);
		color: rgba(242,240,247,0.95);
	}

	.modes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		width: 100%;
		max-width: 360px;
	}
	.mode {
		padding: 14px 0;
		border-radius: 12px;
		border: 1px solid rgba(255,255,255,0.08);
		background: rgba(255,255,255,0.03);
		color: rgba(255,255,255,0.55);
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 0.08s, background 0.15s;
	}
	.mode:active { transform: scale(0.96); background: rgba(255,255,255,0.1); }
	.mode.warn { color: #fe6f69; border-color: rgba(254,111,105,0.2); }

	.last {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: rgba(255,255,255,0.2);
	}
	.hint {
		font-size: 11px;
		color: rgba(255,255,255,0.18);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
</style>
