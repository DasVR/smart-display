<script>
	import { onMount } from 'svelte';
	import MetricCard from '$lib/components/MetricCard.svelte';
	import { telemetry, telemetryHistory, gitContext, pushTelemetrySample } from '$lib/stores.js';

	let loading = $state(true);
	let error = $state(null);

	async function fetchTelemetry() {
		try {
			const r = await fetch('/api/telemetry');
			if (!r.ok) throw new Error('telemetry failed');
			pushTelemetrySample(await r.json());
			error = null;
		} catch {
			error = 'live feed offline';
		} finally {
			loading = false;
		}
	}

	async function fetchGit() {
		try {
			const r = await fetch('/api/git');
			if (!r.ok) return;
			gitContext.set(await r.json());
		} catch {
			/* git endpoint is optional */
		}
	}

	onMount(() => {
		fetchTelemetry();
		fetchGit();
		const t = setInterval(fetchTelemetry, 2500);
		const g = setInterval(fetchGit, 15000);
		return () => {
			clearInterval(t);
			clearInterval(g);
		};
	});

	let ramPct = $derived(
		$telemetry?.stats?.ram_total
			? Math.round(($telemetry.stats.ram_used / $telemetry.stats.ram_total) * 100)
			: 0
	);
	let cpuPct = $derived($telemetry?.stats?.cpu ?? 0);
	let netMbps = $derived($telemetry?.stats?.net_mbps ?? 0);
	let containers = $derived($telemetry?.stats?.containers ?? 0);
	let services = $derived($telemetry?.services ?? []);
	let git = $derived($gitContext);
	let hist = $derived($telemetryHistory);

	function fmtNet(v) {
		if (v >= 10) return Math.round(v).toString();
		return Number(v || 0).toFixed(1);
	}
</script>

<div class="dev-hub">
	<header class="hub-head">
		<div>
			<div class="eyebrow">Infrastructure</div>
			<h2 class="hub-title">Dev Wall</h2>
		</div>
		<div class="head-meta">
			<span class="mono">{containers} containers</span>
			<span class="dot" class:ok={!error}></span>
		</div>
	</header>

	<div class="metrics">
		<MetricCard
			label="CPU Load"
			value={loading ? '—' : cpuPct}
			unit="%"
			hint="1m avg"
			tone="cyan"
			points={hist.cpu}
		/>
		<MetricCard
			label="RAM"
			value={loading ? '—' : ramPct}
			unit="%"
			hint={`${$telemetry?.stats?.ram_used ?? '—'} / ${$telemetry?.stats?.ram_total ?? '—'} GB`}
			tone="violet"
			points={hist.ram}
		/>
		<MetricCard
			label="Tailscale"
			value={loading ? '—' : fmtNet(netMbps)}
			unit="Mb/s"
			hint={`↓ ${fmtNet($telemetry?.stats?.net_rx)}  ↑ ${fmtNet($telemetry?.stats?.net_tx)}`}
			tone="emerald"
			points={hist.net}
		/>
	</div>

	<div class="lower">
		<section class="svc-block">
			<div class="section-label">Services</div>
			{#if error}
				<div class="muted">{error}</div>
			{:else}
				<ul class="svc-list">
					{#each services as s, i (s.name ?? i)}
						<li>
							<span class="svc-name">{s.name}</span>
							<span class="pill" class:ok={s.status}>{s.status ? 'UP' : 'DOWN'}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="git-block">
			<div class="section-label">Cursor Git</div>
			<div class="git-branch">{git.branch}</div>
			<div class="git-msg">{git.message || 'waiting for repo'}</div>
			<div class="git-meta">
				<span class="mono">{git.sha || '—'}</span>
				<span class="pill" class:ok={!git.dirty}>{git.dirty ? `${git.changed} dirty` : 'clean'}</span>
			</div>
		</section>
	</div>
</div>

<style>
	.dev-hub {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 22px 24px 18px;
		min-height: 0;
	}
	.hub-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 16px;
	}
	.eyebrow,
	.section-label {
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: rgb(148, 163, 184);
	}
	.hub-title {
		margin: 4px 0 0;
		font-size: clamp(1.8rem, 2.4vw, 2.6rem);
		font-weight: 600;
		letter-spacing: -0.03em;
		color: #fff;
	}
	.head-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		color: rgb(148, 163, 184);
		font-size: 14px;
	}
	.mono {
		font-family: var(--font-display);
		letter-spacing: 0.04em;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgb(252, 165, 165);
	}
	.dot.ok {
		background: rgb(52, 211, 153);
		box-shadow: 0 0 10px rgba(52, 211, 153, 0.7);
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}
	.lower {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1.2fr 0.8fr;
		gap: 14px;
	}
	.svc-block,
	.git-block {
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(2, 6, 23, 0.28);
		padding: 14px 16px;
		overflow: hidden;
	}
	.svc-list {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.svc-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	.svc-name {
		font-size: 18px;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.92);
	}
	.pill {
		font-family: var(--font-display);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		padding: 4px 9px;
		border-radius: 999px;
		color: rgb(148, 163, 184);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}
	.pill.ok {
		color: rgb(52, 211, 153);
		border-color: rgba(52, 211, 153, 0.35);
		background: rgba(52, 211, 153, 0.12);
	}
	.git-branch {
		margin-top: 8px;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 600;
		color: #fff;
	}
	.git-msg {
		margin-top: 6px;
		font-size: 15px;
		color: rgb(148, 163, 184);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.git-meta {
		margin-top: 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: rgb(100, 116, 139);
		font-size: 13px;
	}
	.muted {
		margin-top: 12px;
		color: rgb(148, 163, 184);
	}
</style>
