<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 4 · Restraint 4 · Variety 4
	Phone remote: power, channel pad, night schedule. Not a settings dump.
-->
<script>
	import '../../app.css';
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import { primeAudio, playChime, playVolumeTick } from '$lib/services/chime.js';

	const current = writable('clock');
	const views = [
		{ id: 'clock', label: 'Clock' },
		{ id: 'school', label: 'School' },
		{ id: 'dev', label: 'Dev' },
		{ id: 'music', label: 'Music' },
		{ id: 'weather', label: 'Weather' }
	];
	const weekDays = [
		{ id: 0, short: 'S', name: 'Sunday' },
		{ id: 1, short: 'M', name: 'Monday' },
		{ id: 2, short: 'T', name: 'Tuesday' },
		{ id: 3, short: 'W', name: 'Wednesday' },
		{ id: 4, short: 'T', name: 'Thursday' },
		{ id: 5, short: 'F', name: 'Friday' },
		{ id: 6, short: 'S', name: 'Saturday' }
	];
	const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
	let nightTab = $state('times');
	let days = $state([0, 1, 2, 3, 4, 5, 6]);
	let volume = $state(0.6);
	let muted = $state(false);
	let volumeError = $state('');
	let volumeTimer = 0;

	function applyAudio(audio) {
		if (!audio || typeof audio.volume !== 'number') return;
		volume = audio.volume;
		muted = Boolean(audio.muted);
		volumeError = '';
	}

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
		if (Array.isArray(schedule.days)) {
			days = [...new Set(schedule.days.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))].sort(
				(a, b) => a - b
			);
		}
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
				body: JSON.stringify({ enabled: autoNights, wakeOnPhone, offAt, onAt, days })
			});
			const data = await r.json();
			applyDisplay(data);
			lastAction = autoNights ? nightSummaryText() : 'auto nights off';
			playChime('schedule');
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
				if (msg.type === 'init') {
					applyDisplay(msg.display);
					applyAudio(msg.audio);
				}
				if (msg.type === 'display') applyDisplay(msg);
				if (msg.type === 'trigger' && msg.event === 'hdmi_off') hdmi = 'off';
				if (msg.type === 'trigger' && msg.event === 'hdmi_on') hdmi = 'on';
				if (msg.type === 'pong') status = 'connected';
				if (msg.type === 'volume') applyAudio(msg);
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
		playChime('tap');
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

	async function fetchDisplay() {
		try {
			const r = await fetch('/api/display');
			const data = await r.json();
			applyDisplay(data);
		} catch {
			/* ws init will retry */
		}
	}

	async function fetchVolume() {
		try {
			const r = await fetch('/api/volume');
			const data = await r.json();
			if (data.ok) {
				applyAudio(data);
				return;
			}
			volumeError = data.error || 'Volume control unavailable';
		} catch {
			volumeError = 'Volume control unavailable';
		}
	}

	let lastVolumeTickAt = 0;
	function queueVolume(next) {
		volume = next;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (now - lastVolumeTickAt > 32) {
			lastVolumeTickAt = now;
			playVolumeTick(next);
		}
		clearTimeout(volumeTimer);
		volumeTimer = setTimeout(() => saveVolume({ volume: next }), 120);
	}

	async function saveVolume(payload) {
		try {
			const r = await fetch('/api/volume', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = await r.json();
			if (data.ok) {
				applyAudio(data);
				lastAction = data.muted ? 'muted' : `${Math.round((data.volume ?? volume) * 100)}%`;
				return;
			}
			volumeError = data.error || 'Volume control unavailable';
		} catch {
			volumeError = 'Volume control unavailable';
		}
	}

	function toggleMute() {
		playChime(muted ? 'unmute' : 'mute');
		saveVolume({ muted: !muted });
	}

	function daysLabel(selected = days) {
		if (!selected.length) return 'no days';
		if (selected.length === 7) return '';
		return selected.map((day) => dayNames[day]).join(' ');
	}

	function nightSummaryText() {
		if (!autoNights) return 'manual';
		const dayBit = daysLabel();
		const when = `${offAt} to ${onAt}`;
		return dayBit ? `${when} · ${dayBit}` : when;
	}

	function toggleDay(day) {
		if (days.includes(day)) days = days.filter((item) => item !== day);
		else days = [...days, day].sort((a, b) => a - b);
		queueSave();
		playChime('tap');
	}

	function setNightTab(tab) {
		if (nightTab === tab) return;
		nightTab = tab;
		playChime('tap');
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
	let swipeArmed = false;
	function isVolumeGesture(target) {
		return Boolean(target?.closest?.('.volume-block'));
	}
	function touchStart(e) {
		if (isVolumeGesture(e.target)) {
			swipeArmed = false;
			return;
		}
		swipeArmed = true;
		touchStartX = e.changedTouches[0].screenX;
		touchStartY = e.changedTouches[0].screenY;
	}
	function touchEnd(e) {
		if (!swipeArmed || isVolumeGesture(e.target)) {
			swipeArmed = false;
			return;
		}
		swipeArmed = false;
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
		fetchDisplay();
		fetchVolume();
		const ping = setInterval(() => {
			if (status === 'connected' && ws?.readyState === 1) {
				ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, 5000);
		// Browsers block audio until a real user gesture; the first touch on
		// the remote unlocks it so subsequent taps can chime.
		window.addEventListener('pointerdown', primeAudio, { once: true });
		return () => {
			clearInterval(ping);
			window.removeEventListener('pointerdown', primeAudio);
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
		<div class="bar-end">
			<a class="stats-link" href="/remote/stats">Stats</a>
			<p class="panel" class:off={hdmi === 'off'}>{hdmi === 'off' ? 'Panel off' : 'Panel on'}</p>
		</div>
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

	<section
		class="block volume-block"
		aria-label="Volume"
		ontouchstart={(e) => e.stopPropagation()}
		ontouchend={(e) => e.stopPropagation()}
	>
		<p class="kicker">Volume</p>
		<div class="volume-row">
			<button
				class="mute-toggle"
				class:muted
				onclick={toggleMute}
				aria-pressed={muted}
				aria-label={muted ? 'Unmute' : 'Mute'}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M4 9v6h4l5 5V4L8 9H4z" />
					{#if muted}
						<path d="M16 9l5 6M21 9l-5 6" />
					{:else}
						<path d="M16.5 8.5a5 5 0 0 1 0 7" />
						<path d="M19 6a8.5 8.5 0 0 1 0 12" />
					{/if}
				</svg>
			</button>
			<input
				class="volume-slider"
				type="range"
				min="0"
				max="1"
				step="0.01"
				bind:value={volume}
				oninput={(e) => queueVolume(Number(e.currentTarget.value))}
			/>
			<span class="volume-pct">{Math.round((muted ? 0 : volume) * 100)}%</span>
		</div>
		{#if volumeError}
			<p class="note">{volumeError}</p>
		{/if}
	</section>

	<section
		class="block night-block"
		aria-label="Night schedule"
		ontouchstart={(e) => e.stopPropagation()}
		ontouchend={(e) => e.stopPropagation()}
	>
		<header class="night-head">
			<span>Night</span>
			<span class="night-summary">{nightSummaryText()}</span>
		</header>
		<div class="night-tabs" role="tablist" aria-label="Schedule">
			<button
				class="night-tab"
				class:on={nightTab === 'times'}
				role="tab"
				aria-selected={nightTab === 'times'}
				onclick={() => setNightTab('times')}
			>
				Times
			</button>
			<button
				class="night-tab"
				class:on={nightTab === 'days'}
				role="tab"
				aria-selected={nightTab === 'days'}
				onclick={() => setNightTab('days')}
			>
				Days
			</button>
		</div>
		<div class="night-body">
			{#if nightTab === 'times'}
				<div class="rockers">
					<button
						class="rocker"
						class:on={autoNights}
						aria-pressed={autoNights}
						onclick={() => {
							autoNights = !autoNights;
							queueSave();
							playChime('tap');
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
							playChime('tap');
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
			{:else}
				<p class="kicker">Off on these nights</p>
				<div class="day-pad" class:disabled={!autoNights} role="group" aria-label="Nights the panel turns off">
					{#each weekDays as day}
						<button
							class="day-key"
							class:on={days.includes(day.id)}
							aria-pressed={days.includes(day.id)}
							aria-label={day.name}
							disabled={!autoNights}
							onclick={() => toggleDay(day.id)}
						>
							{day.short}
						</button>
					{/each}
				</div>
				<p class="note">
					{#if !days.length}
						No nights selected. The panel stays on.
					{:else if days.length === 7}
						Every night.
					{:else}
						Overnight mornings follow the night that started the evening before.
					{/if}
				</p>
			{/if}
		</div>
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
		overflow-x: clip;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.bar-end {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.stats-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
	}
	.stats-link:hover { color: var(--foreground); }
	.stats-link:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
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
		transition: transform 280ms var(--spring-bouncy), border-color 180ms var(--spring-smooth), color 180ms var(--spring-smooth);
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
	.power:active { transform: scale(0.9); transition-duration: 90ms; }
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
	.step,
	.key,
	.rocker,
	.night-tab,
	.day-key {
		transition: transform 280ms var(--spring-bouncy);
	}
	.step:focus-visible,
	.key:focus-visible,
	.rocker:focus-visible,
	.night-tab:focus-visible,
	.day-key:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.step:active,
	.key:active,
	.rocker:active,
	.night-tab:active,
	.day-key:active {
		transform: scale(0.94);
		transition-duration: 90ms;
	}
	.now-name {
		margin: 0;
		text-align: center;
		font-size: 1.75rem;
		font-weight: 700;
		letter-spacing: -0.04em;
		overflow-wrap: anywhere;
	}

	.pad {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}
	.key {
		flex: 0 0 calc((100% - 2 * var(--space-2)) / 3);
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

	.volume-block {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--abyss-2);
		padding: var(--space-3);
		touch-action: auto;
		user-select: auto;
		-webkit-user-select: auto;
	}
	.volume-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.mute-toggle {
		flex-shrink: 0;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		display: grid;
		place-items: center;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 280ms var(--spring-bouncy), color 180ms var(--spring-smooth);
	}
	.mute-toggle svg {
		width: 1.4rem;
		height: 1.4rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.mute-toggle:active {
		transform: scale(0.92);
		transition-duration: 90ms;
	}
	.mute-toggle:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.mute-toggle.muted {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.volume-slider {
		flex: 1;
		height: 2.75rem;
		margin: 0;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		outline: none;
		touch-action: none;
		user-select: auto;
		-webkit-user-select: auto;
	}
	.volume-slider::-webkit-slider-runnable-track {
		height: 0.4rem;
		border-radius: 999px;
		background: var(--shell-fill);
	}
	.volume-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 1.5rem;
		height: 1.5rem;
		margin-top: -0.55rem;
		border-radius: 50%;
		background: var(--foreground);
		border: 1px solid var(--hairline);
		cursor: pointer;
	}
	.volume-slider::-moz-range-track {
		height: 0.4rem;
		border-radius: 999px;
		background: var(--shell-fill);
	}
	.volume-slider::-moz-range-thumb {
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid var(--hairline);
		border-radius: 50%;
		background: var(--foreground);
		cursor: pointer;
	}
	.volume-pct {
		flex-shrink: 0;
		min-width: 3ch;
		text-align: right;
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}

	.night-block {
		flex-shrink: 0;
		min-height: min-content;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--abyss-2);
		padding: var(--space-3);
		gap: var(--space-3);
		touch-action: manipulation;
	}
	.night-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		min-width: 0;
		color: var(--foreground);
		font-size: var(--text-base);
		font-weight: 700;
	}
	.night-head span:first-child {
		flex-shrink: 0;
	}
	.night-summary {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
		text-align: right;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.night-tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.night-tab {
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
	.night-tab.on {
		color: var(--foreground);
		background: color-mix(in srgb, var(--abyss-2) 88%, var(--foreground));
		border-color: color-mix(in srgb, var(--foreground) 22%, transparent);
	}
	.night-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 8.75rem;
		min-width: 0;
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
	.times.disabled,
	.day-pad.disabled { opacity: 0.45; }
	.times label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.times input[type='time'] {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
		color-scheme: dark;
	}
	.day-pad {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--space-1);
	}
	.day-key {
		min-width: 0;
		min-height: 2.75rem;
		padding: 0;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 700;
		cursor: pointer;
		touch-action: manipulation;
	}
	.day-key.on {
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 14%, var(--shell-fill));
		border-color: color-mix(in srgb, var(--ok) 35%, transparent);
	}
	.day-key:disabled {
		cursor: not-allowed;
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
		.key { flex-basis: calc((100% - var(--space-2)) / 2); }
		.rockers { grid-template-columns: 1fr; }
	}
</style>
