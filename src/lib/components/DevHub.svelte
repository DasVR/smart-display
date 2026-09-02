<script>
	import { onMount } from 'svelte';
	import DotMatrix from '$lib/components/DotMatrix.svelte';
	import BracketMeter from '$lib/components/BracketMeter.svelte';
	import AgentMonitor from '$lib/components/AgentMonitor.svelte';
	import { telemetry, gitContext, pushTelemetrySample } from '$lib/stores.js';
	import { ollamaStatus, ollamaModels } from '$lib/services/ollamaArbiter.js';
	import { buildAgents, buildReasoning, buildToolCalls } from '$lib/agentFeed.js';

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
	let netPct = $derived(Math.min(100, Math.round((netMbps / 50) * 100)));
	let containers = $derived($telemetry?.stats?.containers ?? 0);
	let services = $derived($telemetry?.services ?? []);
	let git = $derived($gitContext);

	let agents = $derived(
		buildAgents({
			ollamaStatus: $ollamaStatus,
			ollamaModels: $ollamaModels,
			git,
			telemetry: $telemetry
		})
	);
	let reasoning = $derived(
		buildReasoning({
			ollamaStatus: $ollamaStatus,
			ollamaModels: $ollamaModels,
			git
		})
	);
	let tools = $derived(buildToolCalls({ git, telemetry: $telemetry }));

	function fmtNet(v) {
		if (v >= 10) return Math.round(v).toString();
		return Number(v || 0).toFixed(1);
	}

	let ramHint = $derived(
		`${$telemetry?.stats?.ram_used ?? '--'} / ${$telemetry?.stats?.ram_total ?? '--'} GB`
	);
	let netHint = $derived(
		`Tailscale ${fmtNet(netMbps)} Mb/s · in ${fmtNet($telemetry?.stats?.net_rx)} · out ${fmtNet($telemetry?.stats?.net_tx)}`
	);
</script>

<div class="dev-hub">
	<DotMatrix opacity={0.2} />

	<div class="mark">
		<span>// Dev Wall</span>
		<span>{containers} ctr</span>
	</div>

	<BracketMeter label="CPU" pct={loading ? 0 : cpuPct} hint="1m load" />
	<BracketMeter label="RAM" pct={loading ? 0 : ramPct} hint={ramHint} />
	<BracketMeter label="NET" pct={loading ? 0 : netPct} hint={netHint} />

	<div class="monitor-wrap">
		<AgentMonitor {agents} {reasoning} {tools} seed={cpuPct + ramPct} />
	</div>

	<section class="svc-block">
		<h3 class="section-label">:: Services</h3>
		{#if error}
			<div class="muted">{error}</div>
		{:else if services.length === 0}
			<div class="muted">No services reported</div>
		{:else}
			<ul class="svc-list">
				{#each services as s, i (s.name ?? i)}
					<li class="plate">
						<span class="svc-name">{s.name}</span>
						<span class="state" class:ok={s.status}>{s.status ? '[UP]' : '[DOWN]'}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.dev-hub {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		padding: var(--space-8);
		min-height: 0;
		min-width: 0;
		overflow: auto;
		z-index: 1;
	}
	.mark {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		font-family: var(--font-display);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		flex-shrink: 0;
		z-index: 1;
	}
	.section-label {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 700;
		font-style: normal;
		color: var(--text-tertiary);
		padding-bottom: var(--space-4);
	}
	.monitor-wrap {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: visible;
		z-index: 1;
	}
	.svc-block {
		min-height: 0;
		min-width: 0;
		z-index: 1;
	}
	.svc-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.svc-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		padding: 0 var(--space-4);
		min-height: 4.5rem;
		transition: transform 500ms var(--ease-fluid);
	}
	.svc-list li:active {
		transform: scale(0.98);
	}
	.svc-name {
		font-size: var(--text-xl);
		font-weight: 500;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.state {
		flex-shrink: 0;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		font-family: var(--font-display);
		font-size: var(--text-base);
		font-weight: 700;
		color: var(--warn);
		background: var(--abyss-2);
		box-shadow: var(--inset-spec);
	}
	.state.ok {
		color: var(--ok);
	}
	.muted {
		margin-top: var(--space-2);
		color: var(--text-secondary);
	}
</style>
