<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 4 · Restraint 4 · Variety 4
	Phone remote: power, channel pad, night schedule. Not a settings dump.
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
	const views = KIOSK_VIEWS.map((id) => ({ id, label: kioskViewLabel(id) }));
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
	let linkDown = $state(false);
	let connectTimer = 0;
	let saveFault = $state('');
	let lastAction = $state('');
	let hdmi = $state('on');
	let autoNights = $state(true);
	let wakeOnPhone = $state(true);
	// when the panel is on, per day (src/lib/server/displaySchedule.js); index 0 is Sunday
	let week = $state(Array.from({ length: 7 }, () => ({ mode: 'times', on: '06:00', off: '22:30' })));
	let nextChange = $state(null);
	let scheduleTz = $state('America/New_York');
	let copyFrom = $state(new Date().getDay());
	let hold = $state(null);
	let phone = $state({ source: 'camera', wakeWindow: false });
	let saveTimer = 0;
	let volume = $state(0.6);
	let muted = $state(false);
	let volumeError = $state('');
	// The server passes through raw process errors ("spawn wpctl ENOENT");
	// keep those out of the UI and say what the person can actually tell.
	function volumeMessage(raw) {
		const text = String(raw || '');
		if (/ENOENT|not found|No such file/i.test(text)) return 'No volume control on the display yet';
		if (/timed? ?out/i.test(text)) return 'The display took too long to answer';
		return 'Volume control unavailable';
	}
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
		return kioskViewLabel(id) || id;
	}

	function clockValue(value) {
		const match = String(value ?? '')
			.trim()
			.match(/^(\d{1,2}):([0-5]\d)/);
		if (!match) return String(value ?? '');
		return `${match[1].padStart(2, '0')}:${match[2]}`;
	}

	function applyDisplay(display) {
		if (!display) return;
		if (display.hdmi === 'on' || display.hdmi === 'off') hdmi = display.hdmi;
		if (display.hold === 'on' || display.hold === 'off') hold = display.hold;
		else if ('hold' in display) hold = null;
		const schedule = display.schedule || {};
		if (typeof schedule.enabled === 'boolean') autoNights = schedule.enabled;
		if (typeof schedule.wakeOnPhone === 'boolean') wakeOnPhone = schedule.wakeOnPhone;
		if (Array.isArray(schedule.week) && schedule.week.length === 7) {
			week = schedule.week.map((d) => ({ mode: d.mode, on: clockValue(d.on), off: clockValue(d.off) }));
		}
		if (schedule.timeZone) scheduleTz = schedule.timeZone;
		if ('next' in display) nextChange = display.next;
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
				body: JSON.stringify({ enabled: autoNights, wakeOnPhone })
			});
			const data = await r.json();
			applyDisplay(data);
			lastAction = autoNights ? 'schedule on' : 'schedule off';
			playChime('schedule');
			saveFault = '';
		} catch {
			saveFault = 'That setting did not save. The display did not answer.';
			lastAction = 'save failed';
		}
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

	let linkFault = $derived(
		linkDown && status !== 'connected'
			? 'The remote cannot reach the display. Taps will not go through until it reconnects.'
			: ''
	);
	let statusLabel = $derived(status === 'connecting' && linkDown ? 'reconnecting' : status);

	function armConnectTimeout() {
		clearTimeout(connectTimer);
		connectTimer = setTimeout(() => {
			if (status !== 'connecting') return;
			linkDown = true;
			status = 'error';
			lastAction = 'display did not answer';
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
			lastAction = 'no display address';
			return;
		}
		const url = wallSocketUrl(pickHost());
		try {
			ws = new WebSocket(url);
		} catch (e) {
			status = 'error';
			lastAction = e.message;
			setTimeout(connect, 2000);
			return;
		}
		armConnectTimeout();
		ws.onopen = () => {
			clearTimeout(connectTimer);
			linkDown = false;
			status = 'connected';
			lastMessageAt = Date.now();
			ws.send(JSON.stringify({ type: 'hello', role: 'remote' }));
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
			lastAction = 'ws error';
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
				}
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
			volumeError = volumeMessage(data.error);
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

	// A slider drag can queue several saves in flight (server-side wpctl calls
	// aren't instant); without sequencing, an older request that happens to
	// resolve after a newer one would snap the slider/mute state backwards -
	// exactly the "sometimes just doesn't work" feel. Only the response to
	// the most recently *sent* request is allowed to apply.
	let volumeRequestSeq = 0;
	async function saveVolume(payload) {
		const seq = ++volumeRequestSeq;
		try {
			const r = await fetch('/api/volume', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = await r.json();
			if (seq !== volumeRequestSeq) return;
			if (data.ok) {
				applyAudio(data);
				lastAction = data.muted ? 'muted' : `${Math.round((data.volume ?? volume) * 100)}%`;
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

	/** Save one day ({ mode } or { on } or { off }), or copy a day: the server answers with the new schedule. */
	async function postSchedule(body, what) {
		lastAction = 'saving schedule';
		try {
			const r = await fetch('/api/display', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			applyDisplay(await r.json());
			lastAction = what;
			playChime('schedule');
			saveFault = '';
		} catch {
			saveFault = 'That setting did not save. The display did not answer.';
			lastAction = 'save failed';
		}
	}

	function setDay(day, patch) {
		const value = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, k === 'mode' ? v : clockValue(v)]));
		week = week.map((d, i) => (i === day ? { ...d, ...value } : d));
		copyFrom = day;
		postSchedule({ day, ...value }, `${weekDays[day].name} saved`);
	}

	function copyDay(to) {
		const label = { weekdays: 'weekdays', weekend: 'the weekend', all: 'every day' }[to];
		postSchedule({ copyDay: copyFrom, to }, `${weekDays[copyFrom].name} copied to ${label}`);
		playChime('tap');
	}

	/** "10:30 PM" from "22:30" */
	function clock12(hhmm) {
		const [h, m] = String(hhmm).split(':').map(Number);
		return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
	}

	/** "Off tonight at 10:30 PM", "On tomorrow at 6 AM", "On Sat at 8 AM", on the display's clock. */
	function nextText() {
		if (!autoNights) return 'Manual';
		if (!nextChange) return 'No changes this week';
		const at = new Date(nextChange.at);
		const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: scheduleTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
		const time = new Intl.DateTimeFormat('en-US', { timeZone: scheduleTz, hour: 'numeric', minute: '2-digit' }).format(at).replace(':00', '');
		const today = day(new Date());
		const tomorrow = day(new Date(Date.now() + 86400000));
		const when =
			day(at) === today ? (Number(new Intl.DateTimeFormat('en-US', { timeZone: scheduleTz, hour: 'numeric', hourCycle: 'h23' }).format(at)) >= 17 ? 'tonight' : 'today')
			: day(at) === tomorrow ? 'tomorrow'
			: new Intl.DateTimeFormat('en-US', { timeZone: scheduleTz, weekday: 'short' }).format(at);
		const lead = hold ? `Held ${hdmi} · ` : '';
		return `${lead}${nextChange.to === 'on' ? 'On' : 'Off'} ${when} at ${time}`;
	}

	/** Monday first, the way a week reads */
	const weekOrder = [1, 2, 3, 4, 5, 6, 0];
	let todayIndex = $state(new Date().getDay());
	$effect(() => {
		const t = setInterval(() => (todayIndex = new Date().getDay()), 60000);
		return () => clearInterval(t);
	});

	function phoneNote() {
		return wakeOnPhone
			? `Morning wake: after ${phone.after || '5:00'}, getting up (the webcam sees you go from lying down to upright) turns the panel on with the briefing`
			: 'Morning wake is off';
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
		<div class="status" class:connected={status === 'connected'} class:error={status === 'error' || status === 'disconnected' || linkDown}>
			<span class="dot"></span>
			<span>{statusLabel}</span>
		</div>
		<p class="panel" class:off={hdmi === 'off'}>{hdmi === 'off' ? 'Panel off' : 'Panel on'}</p>
	</header>

	{#if linkFault || saveFault}
		<p class="link-alert" role="alert">{linkFault || saveFault}</p>
	{/if}

	{#if calling.some((i) => i.kind !== 'approval')}
		<AttentionCard items={calling} now={callingNow} compact onack={ackCalling} ondone={doneCalling} onsnooze={laterCalling} />
	{/if}

	{#if pane === 'control'}
		<div class="pane control-pane">
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
				<p class="power-label">
					{hdmi === 'off' ? 'Tap to turn on' : 'Tap to turn off'}{#if autoNights && hold}<span class="power-hold"> · held</span>{/if}
				</p>
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

			{#if lastAction && lastAction !== 'connected'}
				<p class="last">{lastAction}</p>
			{/if}
		</div>
	{:else}
		<div class="pane night-pane">
			<section
				class="block night-block"
				aria-label="Night schedule"
				ontouchstart={(e) => e.stopPropagation()}
				ontouchend={(e) => e.stopPropagation()}
			>
				<header class="night-head">
					<span>Schedule</span>
					<span class="night-summary">{nextText()}</span>
				</header>
				<div class="rockers">
					<button
						class="rocker"
						class:on={autoNights}
						aria-pressed={autoNights}
						onclick={() => {
							autoNights = !autoNights;
							clearTimeout(saveTimer);
							saveNightSchedule();
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
							clearTimeout(saveTimer);
							saveNightSchedule();
							playChime('tap');
						}}
					>
						Morning wake
					</button>
				</div>
				<ul class="week" class:disabled={!autoNights} aria-label="When the panel is on, each day">
					{#each weekOrder as d (d)}
						{@const w = week[d]}
						<li class="day-row" class:today={d === todayIndex} class:picked={d === copyFrom}>
							<button
								type="button"
								class="day-name"
								aria-label="{weekDays[d].name}: pick to copy"
								aria-pressed={d === copyFrom}
								disabled={!autoNights}
								onclick={() => {
									copyFrom = d;
									playChime('tap');
								}}
							>
								{dayNames[d]}
							</button>
							{#if w.mode === 'times'}
								<input
									type="time"
									value={w.on}
									disabled={!autoNights}
									aria-label="{weekDays[d].name} on at"
									onchange={(e) => setDay(d, { on: e.currentTarget.value })}
								/>
								<input
									type="time"
									value={w.off}
									disabled={!autoNights}
									aria-label="{weekDays[d].name} off at"
									onchange={(e) => setDay(d, { off: e.currentTarget.value })}
								/>
							{:else}
								<span class="whole" class:on={w.mode === 'on'}>{w.mode === 'on' ? 'On all day' : 'Off all day'}</span>
							{/if}
							<select
								value={w.mode}
								disabled={!autoNights}
								aria-label="{weekDays[d].name}"
								onchange={(e) => setDay(d, { mode: e.currentTarget.value })}
							>
								<option value="times">Times</option>
								<option value="on">On all day</option>
								<option value="off">Off all day</option>
							</select>
						</li>
					{/each}
				</ul>
				<div class="copy" class:disabled={!autoNights}>
					<span>Copy {dayNames[copyFrom]} to</span>
					<button type="button" disabled={!autoNights} onclick={() => copyDay('weekdays')}>Weekdays</button>
					<button type="button" disabled={!autoNights} onclick={() => copyDay('weekend')}>Weekend</button>
					<button type="button" disabled={!autoNights} onclick={() => copyDay('all')}>Every day</button>
				</div>
				<p class="note">
					On, then off. An off time earlier than the on time means after midnight: Fri 8 AM – 1 AM stays on until 1 AM
					Saturday. {phoneNote()}.
				</p>
			</section>

		</div>
	{/if}
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
		--tabbar-clearance: calc(4.6rem + max(0.75rem, env(safe-area-inset-bottom)));
		width: 100%;
		min-height: 100dvh;
		max-width: 22.5rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding:
			calc(env(safe-area-inset-top) + var(--space-3))
			calc(env(safe-area-inset-right) + var(--space-5))
			calc(var(--tabbar-clearance) + var(--space-3))
			calc(env(safe-area-inset-left) + var(--space-5));
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
		min-height: 2rem;
	}
	/* The everyday controls hug the bottom of the screen, right above the
	   tab bar, so channel, power and volume sit in one-handed thumb reach;
	   the status line stays up top where it only needs to be read. */
	.pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-height: 0;
	}
	.control-pane {
		justify-content: flex-end;
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
	.power:active { transform: scale(0.96); transition-duration: 90ms; }
	.power:disabled { opacity: 0.4; cursor: not-allowed; }
	.power.off { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
	.power-label {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.power-hold {
		font-weight: 600;
		color: var(--text-tertiary);
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
	.rocker {
		transition: transform 280ms var(--spring-bouncy);
	}
	.step:focus-visible,
	.key:focus-visible,
	.rocker:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.step:active,
	.key:active,
	.rocker:active {
		transform: scale(0.96);
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
		transform: scale(0.96);
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
	.week {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.week.disabled,
	.copy.disabled {
		opacity: 0.45;
	}
	.day-row {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr) minmax(0, 1fr) 2.25rem;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
	}
	.day-row .whole {
		grid-column: 2 / span 2;
		min-height: 2.5rem;
		display: grid;
		place-items: center;
		border-radius: var(--radius-md);
		border: 1px dashed var(--hairline);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.day-row .whole.on {
		color: var(--ok);
		border-color: color-mix(in srgb, var(--ok) 35%, transparent);
	}
	.day-name {
		min-height: 2.5rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 700;
		cursor: pointer;
	}
	.day-row.today .day-name {
		color: var(--foreground);
	}
	.day-row.picked .day-name {
		border-color: color-mix(in srgb, var(--foreground) 22%, transparent);
		background: var(--shell-fill);
	}
	.day-row input[type='time'] {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		min-height: 2.5rem;
		padding: 0 var(--space-2);
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color-scheme: dark;
	}
	.day-row input[type='time']::-webkit-calendar-picker-indicator {
		display: none;
	}
	/* the mode menu: a small chevron button over a native select */
	.day-row select {
		width: 2.25rem;
		min-height: 2.5rem;
		padding: 0;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill)
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")
			center / 1rem no-repeat;
		color: transparent;
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
	}
	.day-row select option {
		color: initial;
	}
	.copy {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.copy span {
		margin-right: var(--space-1);
	}
	.copy button {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
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
	.note,
	.last {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.35;
	}
	.link-alert {
		color: var(--warn);
	}
	.link-alert {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		font-size: var(--text-sm);
		font-weight: 600;
		line-height: 1.4;
	}
	.last { font-family: var(--font-code); }

	@media (max-width: 360px) {
		.key { flex-basis: calc((100% - var(--space-2)) / 2); }
		.rockers { grid-template-columns: 1fr; }
	}
</style>
