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
	let netHint = $derived(
		`in ${fmtNet($telemetry?.stats?.net_rx)} · out ${fmtNet($telemetry?.stats?.net_tx)}`
	);
</script>

<div class="dev-hub">
	<div class="mark">
		<span>Dev Wall</span>
		<span>{containers} containers</span>
	</div>

	<div class="metrics-bar">
		<MetricCard
			label="CPU"
			value={loading ? '--' : cpuPct}
			unit="%"
			hint="1m avg"
			points={hist.cpu}
			warnAt={80}
		/>
		<MetricCard
			label="Memory"
			value={loading ? '--' : ramPct}
			unit="%"
			hint={ramHint}
			points={hist.ram}
			warnAt={85}
		/>
		<MetricCard
			label="Net"
			value={loading ? '--' : fmtNet(netMbps)}
			unit="Mb/s"
			hint={netHint}
			points={hist.net}
		/>
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
		gap: var(--space-4);
		padding: var(--space-4);
		min-height: 0;
		min-width: 0;
	}
	.mark {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		font-size: 13px;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}
	.metrics-bar {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		border-bottom: 1px solid var(--border);
		padding-bottom: var(--space-2);
		flex-shrink: 0;
		min-width: 0;
	}
	.section-label {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		font-style: normal;
		color: var(--text-tertiary);
	}
	.svc-block {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: auto;
	}
	.svc-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border);
	}
	.svc-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border);
		min-height: 40px;
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
		gap: var(--space-4);
		align-items: baseline;
		font-size: 12px;
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
		flex-shrink: 0;
	}
	.muted {
		margin-top: var(--space-2);
		color: var(--text-secondary);
	}

	@media (max-width: 414px) {
		.metrics-bar {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
