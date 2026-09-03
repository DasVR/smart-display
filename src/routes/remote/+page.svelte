<script>
	import '../../app.css';
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';

	const current = writable('clock');
	const views = ['clock', 'school', 'dev', 'music', 'weather'];

	let ws = $state(null);
	let status = $state('connecting');
	let lastAction = $state('');
	let host = $state('');

	function pickHost() {
		const h = location.host;
		if (h) return h;
		return '100.104.181.43:3000';
	}

	function viewLabel(name) {
		return name.slice(0, 1).toUpperCase() + name.slice(1);
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
	<title>Smart Display remote</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
	<meta name="theme-color" content="#07070b">
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
		<div class="host">{host || 'finding host'}</div>
	</div>

	<div class="hero">
		<button class="arrow" aria-label="previous" onclick={prev}>‹</button>
		<div class="current">
			<p class="current-label">Now showing</p>
			<p class="current-name">{viewLabel($current)}</p>
		</div>
		<button class="arrow" aria-label="next" onclick={next}>›</button>
	</div>

	<div class="views" role="tablist" aria-label="Views">
		{#each views as v}
			<button
				class="view-btn"
				class:active={v === $current}
				onclick={() => go(v)}
				role="tab"
				aria-selected={v === $current}
				aria-label={`Show ${viewLabel(v)}`}
			>
				{viewLabel(v)}
			</button>
		{/each}
	</div>

	<div class="modes">
		<button class="mode" onclick={() => send({ type: 'trigger', event: 'sleep' })}>Sleep</button>
		<button class="mode" onclick={() => send({ type: 'trigger', event: 'normal' })}>Normal</button>
		<button class="mode warn" onclick={() => send({ type: 'trigger', event: 'hdmi_off' })}>HDMI off</button>
		<button class="mode" onclick={() => send({ type: 'trigger', event: 'hdmi_on' })}>HDMI on</button>
	</div>

	{#if lastAction}
		<p class="last">{lastAction}</p>
	{/if}

	<p class="hint">Swipe anywhere to switch</p>
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: var(--background);
		color: var(--foreground);
		font-family: var(--font-body);
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
		padding: var(--space-6) var(--space-5) max(var(--space-6), env(safe-area-inset-bottom));
		box-sizing: border-box;
		user-select: none;
		-webkit-user-select: none;
	}
	.top {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.25rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--shell-fill);
		box-shadow: var(--inset-spec);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.status.connected { color: var(--ok); }
	.status.error { color: var(--warn); }
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--text-tertiary);
		flex-shrink: 0;
	}
	.status.connected .dot { background: var(--ok); }
	.status.error .dot { background: var(--warn); }
	.host {
		font-size: var(--text-sm);
		font-family: var(--font-code);
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
		min-width: 0;
	}

	.hero {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		width: 100%;
		justify-content: center;
	}
	.arrow {
		width: 5.5rem;
		height: 5.5rem;
		border-radius: var(--radius-lg);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		box-shadow: var(--inset-spec);
		color: var(--foreground);
		font-size: 2.5rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 220ms var(--spring-smooth), background 220ms var(--spring-smooth);
	}
	.arrow:hover { color: var(--brand); }
	.arrow:active { transform: scale(0.96); }
	.current {
		text-align: left;
		min-width: 7.5rem;
	}
	.current-label {
		margin: 0 0 var(--space-1);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.current-name {
		margin: 0;
		font-family: var(--font-body);
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.04em;
		color: var(--foreground);
	}

	.views {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		width: 100%;
		max-width: 22.5rem;
	}
	.view-btn {
		min-height: 3.5rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		box-shadow: var(--inset-spec);
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.02em;
		cursor: pointer;
		touch-action: manipulation;
		transition:
			transform 220ms var(--spring-smooth),
			background 220ms var(--spring-smooth),
			border-color 220ms var(--spring-smooth),
			color 220ms var(--spring-smooth);
	}
	.view-btn:hover { color: var(--foreground); }
	.view-btn:active { transform: scale(0.98); }
	.view-btn.active {
		background: color-mix(in srgb, var(--abyss-2) 88%, var(--foreground));
		color: var(--foreground);
		border-color: color-mix(in srgb, var(--foreground) 22%, transparent);
	}

	.modes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		width: 100%;
		max-width: 22.5rem;
	}
	.mode {
		padding: var(--space-4) 0;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--abyss-2);
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 220ms var(--spring-smooth), background 220ms var(--spring-smooth);
	}
	.mode:active { transform: scale(0.98); }
	.mode.warn { color: var(--warn); }

	.last {
		margin: 0;
		font-family: var(--font-code);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
</style>
