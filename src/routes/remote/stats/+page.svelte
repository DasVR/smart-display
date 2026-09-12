<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 5 · Restraint 4 · Variety 4
	Phone stats: AirPlay first, then the rest of the box. Not a settings dump.
-->
<script>
	import '../../../app.css';
	import { onMount } from 'svelte';

	let data = $state(null);
	let status = $state('reading');
	let error = $state('');

	function serviceOk(item) {
		return Boolean(item?.status);
	}

	function serviceDetail(item) {
		const detail = item?.uptime || '';
		if (serviceOk(item)) return detail;
		if (/%/.test(detail)) return 'down';
		return detail;
	}

	function hdmiLabel(hdmi) {
		if (hdmi === 'off') return 'Panel off';
		if (hdmi === 'on') return 'Panel on';
		return 'Panel unknown';
	}

	function formatUptime(seconds) {
		const s = Math.max(0, Math.floor(Number(seconds) || 0));
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d) return `${d}d ${h}h`;
		if (h) return `${h}h ${m}m`;
		return `${m}m`;
	}

	function connectedLabel(bluetooth) {
		const list = bluetooth?.connected || [];
		if (!list.length) return 'none connected';
		return list.map((d) => d.name || d.address).join(', ');
	}

	async function refresh(signal) {
		try {
			const r = await fetch('/api/kiosk', { signal });
			if (!r.ok) throw new Error(`kiosk ${r.status}`);
			data = await r.json();
			status = 'live';
			error = '';
		} catch (e) {
			if (e?.name === 'AbortError') return;
			status = 'error';
			error = e.message || 'could not reach the kiosk';
		}
	}

	onMount(() => {
		const ac = new AbortController();
		refresh(ac.signal);
		const tick = setInterval(() => refresh(ac.signal), 3000);
		return () => {
			ac.abort();
			clearInterval(tick);
		};
	});
</script>

<svelte:head>
	<title>Display stats</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
	<meta name="theme-color" content="#07070b">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta name="apple-mobile-web-app-title" content="Stats">
	<link rel="manifest" href="/manifest.webmanifest">
</svelte:head>

<div class="remote" role="region" aria-label="Kiosk stats">
	<header class="bar">
		<a class="back" href="/remote">Remote</a>
		<div class="status" class:connected={status === 'live'} class:error={status === 'error'}>
			<span class="dot"></span>
			<span>{status}</span>
		</div>
	</header>

	{#if error && !data}
		<p class="note">{error}</p>
	{:else if !data}
		<p class="note">Reading the box</p>
	{:else}
		<section class="card airplay" aria-label="AirPlay">
			<p class="kicker">AirPlay</p>
			<p class="name">{data.airplay?.name || 'Smart Display'}</p>
			<p class="hint" class:ok={data.airplay?.ready} class:warn={!data.airplay?.ready}>
				{data.airplay?.hint || 'AirPlay is not ready'}
			</p>
			<ul class="rows">
				<li>
					<span>AirPlay 2</span>
					<strong class:ok={data.airplay?.airplay2} class:warn={!data.airplay?.airplay2}>
						{data.airplay?.airplay2 ? (data.airplay.version ? `yes ${data.airplay.version}` : 'yes') : 'no'}
					</strong>
				</li>
				<li>
					<span>Receiver</span>
					<strong class:ok={data.airplay?.unit === 'active'} class:warn={data.airplay?.unit !== 'active'}>
						{data.airplay?.unit || 'unknown'}
					</strong>
				</li>
				<li>
					<span>nqptp</span>
					<strong class:ok={data.airplay?.nqptp === 'active'} class:warn={data.airplay?.nqptp !== 'active'}>
						{data.airplay?.nqptp || 'unknown'}
					</strong>
				</li>
				<li>
					<span>Avahi</span>
					<strong class:ok={data.airplay?.avahi === 'active'} class:warn={data.airplay?.avahi !== 'active'}>
						{data.airplay?.avahi || 'unknown'}
					</strong>
				</li>
			</ul>
		</section>

		<section class="pair" aria-label="Panel and speakers">
			<div class="card">
				<p class="kicker">Panel</p>
				<p class="value" class:warn={data.panel?.hdmi === 'off'}>{hdmiLabel(data.panel?.hdmi)}</p>
			</div>
			<div class="card">
				<p class="kicker">Speakers</p>
				<p class="value" class:warn={!data.speakers?.ok}>
					{data.speakers?.pick?.name || 'none found'}
				</p>
				<p class="meta">{data.speakers?.kind || 'none'}</p>
			</div>
		</section>

		<section class="card" aria-label="Bluetooth">
			<p class="kicker">Bluetooth</p>
			<p class="value" class:warn={!data.bluetooth?.powered}>
				{data.bluetooth?.powered ? 'Adapter on' : 'Adapter off'}
			</p>
			<p class="meta">{connectedLabel(data.bluetooth)}</p>
		</section>

		{#if data.nowPlaying?.title || data.nowPlaying?.playing}
			<section class="card" aria-label="Now playing">
				<p class="kicker">Now playing</p>
				<p class="value">{data.nowPlaying.title || 'Unknown title'}</p>
				<p class="meta">
					{data.nowPlaying.artist || ''}
					{#if data.nowPlaying.source}
						<span>· {data.nowPlaying.source}</span>
					{/if}
				</p>
			</section>
		{/if}

		<section class="card" aria-label="Host">
			<p class="kicker">Host</p>
			<p class="value">{data.host || 'kiosk'}</p>
			<ul class="rows">
				<li>
					<span>CPU</span>
					<strong>{data.stats?.cpu ?? 'n/a'}%</strong>
				</li>
				<li>
					<span>RAM</span>
					<strong>{data.stats?.ram_used ?? 'n/a'} / {data.stats?.ram_total ?? 'n/a'} GB</strong>
				</li>
				<li>
					<span>Net</span>
					<strong>{data.stats?.net_mbps ?? 'n/a'} Mb/s</strong>
				</li>
				<li>
					<span>Boxes</span>
					<strong>{data.stats?.containers ?? 'n/a'}</strong>
				</li>
				<li>
					<span>Up</span>
					<strong>{formatUptime(data.uptime)}</strong>
				</li>
			</ul>
		</section>

		<section class="card" aria-label="Services">
			<p class="kicker">Services</p>
			<ul class="services">
				{#each data.services || [] as svc}
					<li class:ok={serviceOk(svc)} class:warn={!serviceOk(svc)}>
						<span class="dot"></span>
						<span class="svc-name">{svc.name}</span>
						<span class="svc-detail">{serviceDetail(svc)}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="card" aria-label="Git">
			<p class="kicker">Git</p>
			<p class="value">{data.git?.branch || 'unknown'}</p>
			<p class="meta">
				{data.git?.sha || ''}
				{#if data.git?.dirty}
					<span> · dirty</span>
				{/if}
			</p>
		</section>
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
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5) max(var(--space-6), env(safe-area-inset-bottom));
		box-sizing: border-box;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.back,
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
		text-decoration: none;
	}
	.back:hover { color: var(--foreground); }
	.back:focus-visible,
	.status:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.status.connected { color: var(--ok); }
	.status.error { color: var(--warn); }
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--text-tertiary);
		flex: 0 0 auto;
	}
	.status.connected .dot { background: var(--ok); }
	.status.error .dot { background: var(--warn); }

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--abyss-2);
	}
	.airplay {
		background: var(--abyss-1);
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		min-width: 0;
	}
	.pair .card { min-width: 0; }
	.kicker {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.name,
	.value {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 700;
		letter-spacing: -0.03em;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.hint,
	.meta,
	.note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.35;
		overflow-wrap: anywhere;
	}
	.hint.ok,
	.value.ok,
	strong.ok { color: var(--ok); }
	.hint.warn,
	.value.warn,
	strong.warn { color: var(--warn); }

	.rows,
	.services {
		list-style: none;
		margin: var(--space-1) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.rows li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.rows strong {
		color: var(--foreground);
		font-weight: 600;
		text-align: right;
	}
	.services li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
		min-width: 0;
	}
	.services .ok .dot { background: var(--ok); }
	.services .warn .dot { background: var(--warn); }
	.svc-name {
		font-weight: 600;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.svc-detail {
		color: var(--text-tertiary);
		text-align: right;
		max-width: 9rem;
		overflow-wrap: anywhere;
	}

	@media (max-width: 360px) {
		.pair { grid-template-columns: 1fr; }
	}
</style>
