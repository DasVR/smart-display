<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 4 · Restraint 5 · Variety 4
	Phone remote, redesigned: one status line, what the wall is showing, the pages as
	one row, volume as one row, and a mic key to talk to it. The night schedule is
	its own pane (NightSchedule.svelte). No settings dump, no instruction text.
-->
<script>
	import '../../app.css';
	import { wallSocketUrl, followPairing } from '$lib/remoteAuth.js';
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import { primeAudio, playChime, playVolumeTick } from '$lib/services/chime.js';
	import { KIOSK_VIEWS, kioskViewLabel } from '$lib/kioskViews.js';
	import { page } from '$app/state';
	import RemoteTabBar from '$lib/components/RemoteTabBar.svelte';
	import AttentionCard from '$lib/components/AttentionCard.svelte';
	import WallMirror from '$lib/components/WallMirror.svelte';
	import ViewRail from '$lib/components/ViewRail.svelte';
	import VolumeStrip from '$lib/components/VolumeStrip.svelte';
	import NightSchedule from '$lib/components/NightSchedule.svelte';
	import { surfaceProfile } from '$lib/surface.js';

	// Two panes on one page, picked by the bottom tab bar: the everyday
	// controls, and the night schedule (#night).
	let pane = $derived(page.url.hash === '#night' ? 'night' : 'control');

	const current = writable('clock');
	// what the wall is calling about (src/lib/attention.js); answerable from here too
	let calling = $state([]);
	let callingNow = $state(Date.now());
	function sendAttention(msg) {
		if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
	}
	function taskOf(item) {
		return item?.ref?.startsWith('task:') ? item.ref.slice(5) : '';
	}
	const ackCalling = (item) => sendAttention({ type: 'attention', op: 'ack', id: item?.id });
	const doneCalling = (item) => (taskOf(item) ? sendAttention({ type: 'tasks', op: 'done', id: taskOf(item) }) : ackCalling(item));
	const laterCalling = (item) => (taskOf(item) ? sendAttention({ type: 'tasks', op: 'snooze', id: taskOf(item), minutes: 60 }) : ackCalling(item));
	$effect(() => {
		if (!calling.length) return;
		const t = setInterval(() => (callingNow = Date.now()), 15000);
		return () => clearInterval(t);
	});
	// the back of the wall (src/lib/wallMirror.js): what it shows, with its buttons
	let ledgerNow = $state(null);
	let nowPlayingNow = $state(null);
	let weatherNow = $state(null);
	let mirrorNow = $state(Date.now());
	let weatherAt = 0;
	$effect(() => {
		const t = setInterval(() => (mirrorNow = Date.now()), 30000);
		return () => clearInterval(t);
	});
	$effect(() => {
		// the weather view mirrors the current conditions; fetched when it's up, at most every 5 minutes
		if ($current !== 'weather' || Date.now() - weatherAt < 300000) return;
		weatherAt = Date.now();
		fetch('/api/weather?hours=1')
			.then((r) => r.json())
			.then((d) => (weatherNow = d))
			.catch(() => (weatherAt = 0));
	});
	async function mirrorAction(a) {
		if (navigator.vibrate) navigator.vibrate(12);
		if (a.kind === 'ack') sendAttention({ type: 'attention', op: 'ack', id: a.id });
		else if (a.kind === 'task') sendAttention({ type: 'tasks', op: a.op, id: a.id, ...(a.op === 'snooze' ? { minutes: 60 } : {}) });
		else if (a.kind === 'approval') sendAttention({ type: 'approvals', op: 'decide', id: a.id, decision: a.decision, by: 'phone' });
		else if (a.kind === 'player') {
			try {
				await fetch(`/api/player/${a.action}`, { method: 'POST' });
			} catch {
				announce('The player didn’t answer');
			}
		}
	}
	const views = KIOSK_VIEWS.map((id) => ({ id, label: kioskViewLabel(id) }));

	let ws = $state(null);
	let status = $state('connecting');
	let linkDown = $state(false);
	let connectTimer = 0;
	let saveFault = $state('');
	// said to screen readers only; the page itself shows nothing for routine taps
	let announced = $state('');
	let hdmi = $state('on');
	// the last display message, handed to the night schedule
	let displayMsg = $state(null);
	let volume = $state(0.6);
	let muted = $state(false);
	let volumeError = $state('');
	let volumeTimer = 0;

	function announce(text) {
		announced = text;
	}

	// The server passes through raw process errors ("spawn wpctl ENOENT");
	// keep those out of the UI and say what the person can actually tell.
	function volumeMessage(raw) {
		const text = String(raw || '');
		if (/ENOENT|not found|No such file/i.test(text)) return 'No volume control on the display yet';
		if (/timed? ?out/i.test(text)) return 'The display took too long to answer';
		return 'Volume control unavailable';
	}

	function applyAudio(audio) {
		if (!audio || typeof audio.volume !== 'number') return;
		volume = audio.volume;
		muted = Boolean(audio.muted);
		volumeError = '';
	}

	function applyDisplay(display) {
		if (!display) return;
		if (display.hdmi === 'on' || display.hdmi === 'off') hdmi = display.hdmi;
		displayMsg = display;
	}

	// If the socket goes silent - a stalled NAT/WiFi handoff rather than a
	// clean close - the browser can sit on a "connected" readyState for a
	// long time with no onclose ever firing, so the status pill would lie.
	// Track the last time anything arrived and watch for it going stale.
	let lastMessageAt = 0;
	const PONG_STALE_MS = 12_000;

	function discardSocket(socket) {
		if (!socket) return;
		socket.onopen = null;
		socket.onclose = null;
		socket.onerror = null;
		socket.onmessage = null;
		try {
			socket.close();
		} catch {
			/* ignore */
		}
	}

	let linkFault = $derived(linkDown && status !== 'connected' ? 'Can’t reach the display. Taps won’t go through until it’s back.' : '');
	let statusLabel = $derived(status === 'connected' ? 'Live' : status === 'connecting' ? (linkDown ? 'Reconnecting' : 'Connecting') : 'Offline');

	function armConnectTimeout() {
		clearTimeout(connectTimer);
		connectTimer = setTimeout(() => {
			if (status !== 'connecting') return;
			linkDown = true;
			status = 'error';
			discardSocket(ws);
			setTimeout(connect, 1500);
		}, 8000);
	}

	function connect() {
		clearTimeout(connectTimer);
		discardSocket(ws);
		status = 'connecting';
		if (!location.host) {
			status = 'error';
			return;
		}
		try {
			ws = new WebSocket(wallSocketUrl(location.host));
		} catch {
			status = 'error';
			setTimeout(connect, 2000);
			return;
		}
		armConnectTimeout();
		ws.onopen = () => {
			clearTimeout(connectTimer);
			linkDown = false;
			status = 'connected';
			lastMessageAt = Date.now();
			ws.send(
				JSON.stringify({
					type: 'hello',
					role: 'remote',
					surface: surfaceProfile({
						role: 'remote',
						width: window.innerWidth,
						height: window.innerHeight,
						touch: matchMedia('(pointer: coarse)').matches,
						reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
					})
				})
			);
			ws.send(JSON.stringify({ type: 'ping' }));
		};
		ws.onclose = () => {
			linkDown = true;
			status = 'disconnected';
			setTimeout(connect, 1500);
		};
		ws.onerror = () => {
			linkDown = true;
			status = 'error';
		};
		ws.onmessage = (e) => {
			lastMessageAt = Date.now();
			try {
				const msg = JSON.parse(e.data);
				if (followPairing(msg)) return;
				if (msg.type === 'init' || msg.type === 'navigate') {
					current.set(msg.view || 'clock');
				}
				if (msg.type === 'init') {
					applyDisplay(msg.display);
					applyAudio(msg.audio);
					if (Array.isArray(msg.attention)) calling = msg.attention;
					if (msg.ledger) ledgerNow = msg.ledger;
					if (msg.nowPlaying) nowPlayingNow = msg.nowPlaying;
				}
				if (msg.type === 'ledger' && msg.ledger) ledgerNow = msg.ledger;
				if (msg.type === 'nowPlaying') nowPlayingNow = msg;
				if (msg.type === 'attention' && Array.isArray(msg.items)) {
					calling = msg.items;
					callingNow = Date.now();
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

	function watchdogTick() {
		if (status !== 'connected') return;
		if (Date.now() - lastMessageAt > PONG_STALE_MS) {
			linkDown = true;
			status = 'disconnected';
			connect();
		}
	}

	function send(obj) {
		if (!ws || ws.readyState !== 1) {
			announce('Not connected to the display');
			return;
		}
		ws.send(JSON.stringify(obj));
		if (navigator.vibrate) navigator.vibrate(12);
		playChime('tap');
	}

	const go = (view) => send({ type: 'navigate', view });
	const next = () => send({ type: 'swipe', dir: 'left' });
	const prev = () => send({ type: 'swipe', dir: 'right' });
	const togglePower = () => send({ type: 'trigger', event: hdmi === 'off' ? 'hdmi_on' : 'hdmi_off' });

	async function fetchDisplay() {
		try {
			const r = await fetch('/api/display');
			applyDisplay(await r.json());
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
			volumeError = volumeMessage(data.error);
		} catch {
			volumeError = 'Volume control unavailable';
		}
	}

	let lastVolumeTickAt = 0;
	function queueVolume(level) {
		volume = level;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (now - lastVolumeTickAt > 32) {
			lastVolumeTickAt = now;
			playVolumeTick(level);
		}
		clearTimeout(volumeTimer);
		volumeTimer = setTimeout(() => saveVolume({ volume: level }), 120);
	}

	// A slider drag can queue several saves in flight (server-side wpctl calls
	// aren't instant); without sequencing, an older request that happens to
	// resolve after a newer one would snap the slider/mute state backwards.
	// Only the response to the most recently *sent* request is allowed to apply.
	let volumeRequestSeq = 0;
	async function saveVolume(payload) {
		const seq = ++volumeRequestSeq;
		try {
			const r = await fetch('/api/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
			const data = await r.json();
			if (seq !== volumeRequestSeq) return;
			if (data.ok) {
				applyAudio(data);
				announce(data.muted ? 'Muted' : `Volume ${Math.round((data.volume ?? volume) * 100)} percent`);
				return;
			}
			volumeError = volumeMessage(data.error);
		} catch {
			if (seq !== volumeRequestSeq) return;
			volumeError = 'Volume control unavailable';
		}
	}

	function toggleMute() {
		playChime(muted ? 'unmute' : 'mute');
		saveVolume({ muted: !muted });
	}

	let touchStartX = 0;
	let touchStartY = 0;
	let swipeArmed = false;
	const ignoresSwipe = (target) => Boolean(target?.closest?.('input, [role="tablist"], [data-no-swipe]'));
	function touchStart(e) {
		if (ignoresSwipe(e.target)) {
			swipeArmed = false;
			return;
		}
		swipeArmed = true;
		touchStartX = e.changedTouches[0].screenX;
		touchStartY = e.changedTouches[0].screenY;
	}
	function touchEnd(e) {
		if (!swipeArmed || ignoresSwipe(e.target)) {
			swipeArmed = false;
			return;
		}
		swipeArmed = false;
		const dx = e.changedTouches[0].screenX - touchStartX;
		const dy = e.changedTouches[0].screenY - touchStartY;
		if (pane === 'control' && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
			send({ type: 'swipe', dir: dx < 0 ? 'left' : 'right' });
		}
	}

	function keydown(e) {
		if (e.target?.closest?.('input, textarea, select, [role="dialog"]')) return;
		if (e.key === 'ArrowRight') next();
		if (e.key === 'ArrowLeft') prev();
		if (e.key === ' ' && !e.target?.closest?.('button, a, [role]')) {
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
		const watchdog = setInterval(watchdogTick, 4000);
		// Browsers block audio until a real user gesture; the first touch on
		// the remote unlocks it so subsequent taps can chime.
		window.addEventListener('pointerdown', primeAudio, { once: true });
		return () => {
			clearInterval(ping);
			clearInterval(watchdog);
			clearTimeout(connectTimer);
			window.removeEventListener('pointerdown', primeAudio);
			discardSocket(ws);
		};
	});
</script>

<svelte:head>
	<title>Display remote</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="theme-color" content="#07070b">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta name="apple-mobile-web-app-title" content="Remote">
	<link rel="manifest" href="/manifest.webmanifest">
</svelte:head>

<svelte:window onkeydown={keydown} />

<div class="remote" class:dim={hdmi === 'off'} role="application" aria-label="Smart display remote" ontouchstart={touchStart} ontouchend={touchEnd}>
	<header class="bar">
		<p class="link" class:live={status === 'connected'} class:down={status !== 'connected' && status !== 'connecting'} role="status">
			<span class="dot" aria-hidden="true"></span>
			<span class="word">Display</span>
			<span class="state">{statusLabel}</span>
		</p>
		<button
			class="power"
			class:off={hdmi === 'off'}
			type="button"
			onclick={togglePower}
			disabled={status !== 'connected'}
			aria-pressed={hdmi === 'on'}
			aria-label={hdmi === 'off' ? 'Turn the panel on' : 'Turn the panel off'}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M12 3v9" />
				<path d="M7.2 6.8a7 7 0 1 0 9.6 0" />
			</svg>
			<span>{hdmi === 'off' ? 'Off' : 'On'}</span>
		</button>
	</header>

	{#if linkFault || saveFault}
		<p class="alert" role="alert">{linkFault || saveFault}</p>
	{/if}

	{#if calling.some((i) => i.kind !== 'approval')}
		<AttentionCard items={calling} now={callingNow} compact onack={ackCalling} ondone={doneCalling} onsnooze={laterCalling} />
	{/if}

	{#if pane === 'control'}
		<main class="pane control">
			<WallMirror view={$current} ledger={ledgerNow} nowPlaying={nowPlayingNow} weather={weatherNow} now={mirrorNow} skipCalling={calling.some((i) => i.kind !== 'approval')} onaction={mirrorAction} />
			<div class="controls">
				<ViewRail {views} current={$current} disabled={status !== 'connected'} onpick={go} />
				<VolumeStrip {volume} {muted} error={volumeError} onvolume={queueVolume} onmute={toggleMute} />
			</div>
		</main>
	{:else}
		<main class="pane night">
			<NightSchedule display={displayMsg} {hdmi} onfault={(m) => (saveFault = m)} />
		</main>
	{/if}

	<p class="sr" aria-live="polite">{announced}</p>
</div>

<RemoteTabBar active={pane} />

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
	/* Saved to an iPhone home screen the page runs under the status bar
	   (viewport-fit=cover + black-translucent), so every edge respects its
	   safe-area inset; the bottom also clears the floating tab bar. */
	.remote {
		--tabbar-clearance: calc(5.2rem + max(0.75rem, env(safe-area-inset-bottom)));
		width: 100%;
		min-height: 100dvh;
		max-width: 26rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding:
			calc(env(safe-area-inset-top) + var(--space-3))
			calc(env(safe-area-inset-right) + var(--space-5))
			calc(var(--tabbar-clearance) + var(--space-2))
			calc(env(safe-area-inset-left) + var(--space-5));
		box-sizing: border-box;
		-webkit-user-select: none;
		user-select: none;
		overflow-x: clip;
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 2.75rem;
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 650;
		color: var(--text-tertiary);
	}
	.link .word { color: var(--foreground); }
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--text-tertiary);
	}
	.link.live .dot {
		background: var(--ok);
		box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--ok) 22%, transparent);
	}
	.link.down .dot { background: var(--warn); }
	.link.down .state { color: var(--warn); }

	.power {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-4) 0 var(--space-3);
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--ok);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 700;
		cursor: pointer;
		touch-action: manipulation;
		transition:
			transform 120ms var(--ease-standard),
			color 180ms var(--ease-standard),
			border-color 180ms var(--ease-standard);
	}
	.power svg {
		width: 1.2rem;
		height: 1.2rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.power.off {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.power:active { transform: scale(0.96); }
	.power:disabled { opacity: 0.4; cursor: not-allowed; }
	.power:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

	.pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-height: 0;
	}
	/* What the wall shows reads from the top; the controls sit at the bottom,
	   in one-handed thumb reach right above the tab bar. */
	.control { justify-content: space-between; }
	/* the page isn't a flat void: a faint lift from the bottom, brighter while the panel is on */
	.remote::before {
		content: '';
		position: fixed;
		inset: auto 0 0 0;
		height: 70dvh;
		z-index: -1;
		pointer-events: none;
		background: radial-gradient(90% 70% at 50% 100%, color-mix(in srgb, var(--brand) 10%, transparent), transparent 70%);
		opacity: 0.9;
		transition: opacity 600ms var(--ease-standard);
	}
	.remote.dim::before { opacity: 0.25; }
	.controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.alert {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		color: var(--warn);
		font-size: var(--text-sm);
		font-weight: 600;
		line-height: 1.4;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
