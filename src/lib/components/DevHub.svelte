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

	let ramHint = $derived(
		`${$telemetry?.stats?.ram_used ?? '--'} / ${$telemetry?.stats?.ram_total ?? '--'} GB`
	);
</script>

<div class="dev-hub">
	<div class="mark">
		<span>Dev Wall</span>
		<span>{containers} containers</span>
	</div>

	<MetricCard
		label="CPU"
		value={loading ? '--' : cpuPct}
		unit="%"
		hint="1m avg"
		points={hist.cpu}
	/>

	<div class="ledger" role="table" aria-label="Host inventory">
		<div class="ledger-row" role="row">
			<span class="k" role="cell">Memory</span>
			<span class="v num" role="cell">{loading ? '--' : ramPct}%</span>
			<span class="h" role="cell">{ramHint}</span>
		</div>
		<div class="ledger-row" role="row">
			<span class="k" role="cell">Tailscale</span>
			<span class="v num" role="cell">{loading ? '--' : fmtNet(netMbps)}</span>
			<span class="h" role="cell">Mb/s · in {fmtNet($telemetry?.stats?.net_rx)} · out {fmtNet($telemetry?.stats?.net_tx)}</span>
		</div>
	</div>

	<section class="svc-block">
		<h3 class="section-label">Services</h3>
		{#if error}
			<div class="muted">{error}</div>
		{:else if services.length === 0}
			<div class="muted">No services reported</div>
		{:else}
			<ul class="svc-list">
				{#each services as s, i (s.name ?? i)}
					<li>
						<span class="svc-name">{s.name}</span>
						<span class="state" class:ok={s.status}>{s.status ? 'up' : 'down'}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<p class="gitline">
		<span class="num">{git.branch || 'untracked'}</span>
		<span class="num">{git.sha || '--'}</span>
		<span class="state" class:ok={!git.dirty}>{git.dirty ? `${git.changed} dirty` : 'clean'}</span>
	</p>
</div>

<style>
	.dev-hub {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		min-height: 0;
		min-width: 0;
	}
	.mark {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: 13px;
		color: var(--text-tertiary);
	}
	.section-label {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		font-style: normal;
		color: var(--text-tertiary);
	}
	.ledger {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border);
	}
	.ledger-row {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 4rem) minmax(0, 1fr);
		gap: var(--space-2);
		align-items: baseline;
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border);
		min-width: 0;
	}
	.k {
		font-size: 13px;
		color: var(--text-secondary);
	}
	.v {
		font-size: 15px;
		font-weight: 600;
		color: var(--foreground);
	}
	.h {
		font-size: 12px;
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.svc-block {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: auto;
	}
	.svc-list {
		list-style: none;
		margin: var(--space-1) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.svc-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border);
		min-height: 44px;
	}
	.svc-name {
		font-size: 15px;
		font-weight: 500;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.state {
		font-family: var(--font-display);
		font-size: 12px;
		color: var(--warn);
		flex-shrink: 0;
	}
	.state.ok {
		color: var(--ok);
	}
	.gitline {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: baseline;
		font-size: 12px;
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
	}
	.muted {
		margin-top: var(--space-2);
		color: var(--text-secondary);
	}

	@media (max-width: 768px) {
		.ledger-row {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.h {
			grid-column: 1 / -1;
		}
	}
</style>
