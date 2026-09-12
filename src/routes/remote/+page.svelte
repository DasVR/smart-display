<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 4 · Restraint 4 · Variety 4
	Phone remote: power, channel pad, night tray. Not a settings dump.
-->
<script>
	import '../../app.css';
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';

	const current = writable('clock');
	const views = [
		{ id: 'clock', label: 'Clock' },
		{ id: 'school', label: 'School' },
		{ id: 'dev', label: 'Dev' },
		{ id: 'music', label: 'Music' },
		{ id: 'weather', label: 'Weather' }
	];

	let ws = $state(null);
	let status = $state('connecting');
	let lastAction = $state('');
	let hdmi = $state('on');
	let autoNights = $state(true);
	let wakeOnPhone = $state(true);
	let offAt = $state('22:30');
	let onAt = $state('06:00');
	let phone = $state({ entity: '', label: '', on: false, status: 'idle', wakeWindow: false });
	let saveTimer = 0;
	let nightOpen = $state(true);

	function pickHost() {
		const h = location.host;
		if (h) return h;
		return '100.104.181.43:3000';
	}

	function viewLabel(id) {
		return views.find((v) => v.id === id)?.label || id;
	}

	function applyDisplay(display) {
		if (!display) return;
		if (display.hdmi === 'on' || display.hdmi === 'off') hdmi = display.hdmi;
		const schedule = display.schedule || {};
		if (typeof schedule.enabled === 'boolean') autoNights = schedule.enabled;
		if (typeof schedule.wakeOnPhone === 'boolean') wakeOnPhone = schedule.wakeOnPhone;
		if (schedule.offAt) offAt = schedule.offAt;
		if (schedule.onAt) onAt = schedule.onAt;
		if (display.phone) phone = { ...phone, ...display.phone };
	}

	function queueSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(saveNightSchedule, 400);
	}

	async function saveNightSchedule() {
		lastAction = 'saving nights';
		try {
			const r = await fetch('/api/display', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: autoNights, wakeOnPhone, offAt, onAt })
			});
			const data = await r.json();
			applyDisplay(data);
			lastAction = autoNights ? `nights ${offAt} to ${onAt}` : 'auto nights off';
		} catch (e) {
			lastAction = e.message || 'save failed';
		}
	}

	function connect() {
		if (ws) {
			try {
				ws.close();
			} catch {
				/* ignore */
			}
		}
		status = 'connecting';
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${pickHost()}/ws`;
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
				if (msg.type === 'init') applyDisplay(msg.display);
				if (msg.type === 'display') applyDisplay(msg);
				if (msg.type === 'trigger' && msg.event === 'hdmi_off') hdmi = 'off';
				if (msg.type === 'trigger' && msg.event === 'hdmi_on') hdmi = 'on';
				if (msg.type === 'pong') status = 'connected';
			} catch {
				/* ignore */
			}
		};
	}

	function send(obj) {
		if (!ws || ws.readyState !== 1) {
			lastAction = 'not connected';
			return;
		}
		ws.send(JSON.stringify(obj));
		lastAction = obj.event || obj.view || obj.dir || obj.type;
		if (navigator.vibrate) navigator.vibrate(12);
	}

	function go(view) {
		send({ type: 'navigate', view });
	}

	function next() {
		send({ type: 'swipe', dir: 'left' });
	}
	function prev() {
		send({ type: 'swipe', dir: 'right' });
	}

	function togglePower() {
		send({ type: 'trigger', event: hdmi === 'off' ? 'hdmi_on' : 'hdmi_off' });
	}

	function phoneNote() {
		if (phone.status === 'ok' && phone.label) return `Watching ${phone.label}`;
		if (phone.status === 'missing') return 'No phone screen sensor in HA yet';
		if (phone.status === 'no-auth') return 'Home Assistant is not linked';
		if (phone.status === 'error') return 'Home Assistant unreachable';
		return 'Looking for your phone in HA';
	}

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
		if (e.key === ' ') {
			e.preventDefault();
			togglePower();
		}
	}

	onMount(() => {
		connect();
		const ping = setInterval(() => {
			if (status === 'connected' && ws?.readyState === 1) {
				ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, 5000);
		return () => {
			clearInterval(ping);
			ws?.close();
		};
	});
</script>

<svelte:head>
	<title>Display remote</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
	<meta name="theme-color" content="#07070b">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta name="apple-mobile-web-app-title" content="Remote">
	<link rel="manifest" href="/manifest.webmanifest">
</svelte:head>

<svelte:window onkeydown={keydown} />

<div
	class="remote"
	role="application"
	aria-label="Smart display remote"
	ontouchstart={touchStart}
	ontouchend={touchEnd}
>
	<header class="bar">
		<div class="status" class:connected={status === 'connected'} class:error={status === 'error'}>
			<span class="dot"></span>
			<span>{status}</span>
		</div>
		<p class="panel" class:off={hdmi === 'off'}>{hdmi === 'off' ? 'Panel off' : 'Panel on'}</p>
	</header>

	<section class="block power-block" aria-label="Power">
		<button
			class="power"
			class:off={hdmi === 'off'}
			onclick={togglePower}
			disabled={status !== 'connected'}
			aria-pressed={hdmi === 'on'}
			aria-label={hdmi === 'off' ? 'Turn panel on' : 'Turn panel off'}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M12 3v9" />
				<path d="M7.2 6.8a7 7 0 1 0 9.6 0" />
			</svg>
		</button>
		<p class="power-label">{hdmi === 'off' ? 'Off' : 'On'}</p>
	</section>

	<section class="block" aria-label="Channel">
		<p class="kicker">Channel</p>
		<div class="transport">
			<button class="step" aria-label="previous channel" onclick={prev}>‹</button>
			<div class="now">
				<p class="now-name">{viewLabel($current)}</p>
			</div>
			<button class="step" aria-label="next channel" onclick={next}>›</button>
		</div>
		<div class="pad" role="tablist" aria-label="Views">
			{#each views as v}
				<button
					class="key"
					class:active={v.id === $current}
					onclick={() => go(v.id)}
					role="tab"
					aria-selected={v.id === $current}
					aria-label={`Show ${v.label}`}
				>
					{v.label}
				</button>
			{/each}
		</div>
	</section>

	<section class="block night-block" aria-label="Night">
		<button
			class="night-toggle"
			onclick={() => (nightOpen = !nightOpen)}
			aria-expanded={nightOpen}
		>
			<span>Night</span>
			<span class="night-summary">{autoNights ? `${offAt} to ${onAt}` : 'manual'}</span>
		</button>
		{#if nightOpen}
			<div class="night-body">
				<div class="rockers">
					<button
						class="rocker"
						class:on={autoNights}
						aria-pressed={autoNights}
						onclick={() => {
							autoNights = !autoNights;
							queueSave();
						}}
					>
						Auto schedule
					</button>
					<button
						class="rocker"
						class:on={wakeOnPhone}
						aria-pressed={wakeOnPhone}
						onclick={() => {
							wakeOnPhone = !wakeOnPhone;
							queueSave();
						}}
					>
						Phone wake
					</button>
				</div>
				<div class="times" class:disabled={!autoNights}>
					<label>
						<span>Off</span>
						<input type="time" bind:value={offAt} disabled={!autoNights} onchange={queueSave} />
					</label>
					<label>
						<span>On</span>
						<input type="time" bind:value={onAt} disabled={!autoNights} onchange={queueSave} />
					</label>
				</div>
				<p class="note">{phoneNote()}</p>
			</div>
		{/if}
	</section>

	{#if lastAction && lastAction !== 'connected'}
		<p class="last">{lastAction}</p>
	{/if}
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: var(--background);
		color: var(--foreground);
		font-family: var(--font-body);
		overflow-x: clip;
		-webkit-tap-highlight-color: transparent;
	}
	.remote {
		width: 100%;
		min-height: 100dvh;
		max-width: 22.5rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-4) var(--space-5) max(var(--space-6), env(safe-area-inset-bottom));
		box-sizing: border-box;
		user-select: none;
		-webkit-user-select: none;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.status,
	.panel {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.status.connected { color: var(--ok); }
	.status.error { color: var(--warn); }
	.panel.off { color: var(--warn); }
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--text-tertiary);
	}
	.status.connected .dot { background: var(--ok); }
	.status.error .dot { background: var(--warn); }

	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.kicker {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}

	.power-block {
		align-items: center;
		padding: var(--space-2) 0 var(--space-1);
	}
	.power {
		width: 5.25rem;
		height: 5.25rem;
		border-radius: var(--radius-lg);
		border: 1px solid var(--hairline);
		background: var(--abyss-2);
		box-shadow: var(--inset-spec);
		color: var(--foreground);
		display: grid;
		place-items: center;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 180ms var(--spring-smooth), border-color 180ms var(--spring-smooth), color 180ms var(--spring-smooth);
	}
	.power svg {
		width: 2.1rem;
		height: 2.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
	}
	.power:hover { color: var(--ok); }
	.power:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 3px;
	}
	.power:active { transform: scale(0.96); }
	.power:disabled { opacity: 0.4; cursor: not-allowed; }
	.power.off { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
	.power-label {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}

	.transport {
		display: grid;
		grid-template-columns: 3.5rem 1fr 3.5rem;
		align-items: center;
		gap: var(--space-3);
	}
	.step {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		box-shadow: var(--inset-spec);
		color: var(--foreground);
		font-size: 2rem;
		line-height: 1;
		cursor: pointer;
		touch-action: manipulation;
	}
	.step:focus-visible,
	.key:focus-visible,
	.rocker:focus-visible,
	.night-toggle:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.step:active,
	.key:active,
	.rocker:active { transform: scale(0.97); }
	.now-name {
		margin: 0;
		text-align: center;
		font-size: 1.75rem;
		font-weight: 700;
		letter-spacing: -0.04em;
		overflow-wrap: anywhere;
	}

	.pad {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--space-2);
	}
	.key {
		min-height: 3rem;
		padding: 0 var(--space-2);
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		touch-action: manipulation;
	}
	.key.active {
		background: color-mix(in srgb, var(--abyss-2) 88%, var(--foreground));
		color: var(--foreground);
		border-color: color-mix(in srgb, var(--foreground) 22%, transparent);
	}

	.night-block {
		margin-top: auto;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--abyss-2);
		padding: var(--space-3);
		gap: var(--space-3);
	}
	.night-toggle {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--foreground);
		font-family: var(--font-body);
		font-size: var(--text-base);
		font-weight: 700;
		cursor: pointer;
		text-align: left;
	}
	.night-summary {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.rockers {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.rocker {
		min-height: 2.75rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		touch-action: manipulation;
	}
	.rocker.on {
		color: var(--ok);
		border-color: color-mix(in srgb, var(--ok) 35%, transparent);
	}
	.times {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.times.disabled { opacity: 0.45; }
	.times label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.times input[type='time'] {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.note,
	.last {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.35;
	}
	.last { font-family: var(--font-code); }

	@media (max-width: 360px) {
		.pad { grid-template-columns: 1fr 1fr; }
		.rockers { grid-template-columns: 1fr; }
	}
</style>
