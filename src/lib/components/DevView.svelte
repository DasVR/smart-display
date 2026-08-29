<script>
	import { onMount } from 'svelte';
	import GlassPanel from '$lib/components/GlassPanel.svelte';
	let mounted = false;
	let loading = true;
	let telemetry = { services: [], stats: {} };
	let error = null;

	onMount(() => {
		mounted = true;
		fetchTelemetry();
		const t = setInterval(fetchTelemetry, 5000);
		return () => clearInterval(t);
	});

	async function fetchTelemetry() {
		try {
			const r = await fetch('/api/telemetry');
			if (!r.ok) throw new Error('telemetry failed');
			const d = await r.json();
			telemetry = d;
			error = null;
		} catch (e) {
			error = 'live feed offline';
		} finally {
			loading = false;
		}
	}

	function barColor(v) {
		if (v < 50) return 'var(--ok)';
		if (v < 80) return '#facc15';
		return 'var(--warn)';
	}

	$: ramPct = telemetry?.stats?.ram_total ? Math.round((telemetry.stats.ram_used / telemetry.stats.ram_total) * 100) : 0;
	$: cpuPct = telemetry?.stats?.cpu || 0;
</script>

<div class="dev-view" class:mounted>
	<div class="header">
		<div class="title-block">
			<div class="big-label">DEV</div>
			<div class="sub">{telemetry?.services?.length || 0} services live · {telemetry?.stats?.containers || 0} containers</div>
		</div>
		<div class="time-block">
			<div class="big-number">{cpuPct}<span class="pct">%</span></div>
			<div class="sub">CPU</div>
		</div>
	</div>

	<div class="dashboard">
		<GlassPanel title="Services" meta="uptime">
			{#if loading}
				<div class="skeleton" style="height:260px"></div>
			{:else if error}
				<div class="error">{error}</div>
			{:else}
				<div class="svc-list">
					{#each telemetry.services || [] as s, i}
						<div class="svc-row">
							<div class="svc-left">
								<span class="idx">{i + 1}</span>
								<span class="svc-name">{s.name}</span>
							</div>
							<div class="svc-right">
								<span class="status-pill" class:ok={s.status}>{s.status ? 'UP' : 'DOWN'}</span>
								<span class="uptime">{s.uptime}</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</GlassPanel>

		<div class="metrics">
			<GlassPanel title="RAM">
				<div class="big-stat">
					<div class="big-number">{telemetry?.stats?.ram_used ?? '--'}<span class="unit">GB</span></div>
					<div class="sub">of {telemetry?.stats?.ram_total ?? '--'} GB · {ramPct}%</div>
				</div>
				<div class="bar-wrap">
					<div class="bar-bg"></div>
					<div class="bar-fill" style="width:{ramPct}%; background:{barColor(ramPct)}"></div>
				</div>
			</GlassPanel>

			<GlassPanel title="CPU">
				<div class="big-stat">
					<div class="big-number">{cpuPct}<span class="unit">%</span></div>
					<div class="sub">1-min load avg</div>
				</div>
				<div class="bar-wrap">
					<div class="bar-bg"></div>
					<div class="bar-fill" style="width:{cpuPct}%; background:{barColor(cpuPct)}"></div>
				</div>
			</GlassPanel>

			<GlassPanel title="Containers">
				<div class="big-stat">
					<div class="big-number">{telemetry?.stats?.containers ?? '--'}</div>
					<div class="sub">running on host</div>
				</div>
			</GlassPanel>
		</div>
	</div>
</div>

<style>
	.dev-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 110px 80px 60px;
		gap: 40px;
		opacity: 0;
		transform: translateY(14px);
		transition: opacity 0.5s var(--ease-standard), transform 0.6s var(--ease-standard);
	}
	.dev-view.mounted { opacity: 1; transform: translateY(0); }

	.header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		padding-bottom: 28px;
	}
	.big-label {
		font-family: var(--font-display);
		font-size: clamp(42px, 5vw, 72px);
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}
	.big-number {
		font-family: var(--font-display);
		font-size: clamp(60px, 7vw, 110px);
		font-weight: 700;
		line-height: 1;
		color: var(--text-primary);
	}
	.big-number .unit, .big-number .pct { font-size: 0.35em; color: var(--text-tertiary); margin-left: 4px; }
	.sub { font-size: clamp(18px, 1.6vw, 26px); color: var(--text-secondary); margin-top: 8px; }
	.time-block { text-align: right; }

	.dashboard {
		display: grid;
		grid-template-columns: 1.3fr 1fr;
		gap: 32px;
		flex: 1;
		min-height: 0;
	}
	.metrics {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.svc-list { display: flex; flex-direction: column; }
	.svc-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 22px 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.svc-row:last-child { border-bottom: none; }
	.svc-left { display: flex; align-items: center; gap: 18px; }
	.idx {
		font-family: var(--font-display);
		font-size: 16px;
		color: var(--text-tertiary);
		width: 28px;
	}
	.svc-name { font-size: clamp(24px, 2.2vw, 36px); font-weight: 500; color: var(--text-primary); }
	.svc-right { display: flex; align-items: center; gap: 16px; }
	.status-pill {
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.08em;
		padding: 6px 14px;
		border-radius: var(--r-sm);
		background: rgba(255,255,255,0.07);
		color: var(--text-tertiary);
		border: 1px solid rgba(255,255,255,0.09);
	}
	.status-pill.ok {
		background: rgba(52,211,153,0.16);
		color: var(--ok);
		border-color: rgba(52,211,153,0.3);
		box-shadow: 0 0 14px rgba(52,211,153,0.2);
	}
	.uptime { font-family: var(--font-display); font-size: 18px; color: var(--text-tertiary); }

	.big-stat { padding: 10px 0; }
	.bar-wrap { position: relative; height: 14px; border-radius: 999px; margin-top: 18px; overflow: hidden; }
	.bar-bg { position: absolute; inset: 0; background: rgba(255,255,255,0.06); }
	.bar-fill { position: absolute; inset: 0; width: 0; border-radius: 999px; transition: width 0.5s var(--ease-standard), background 0.3s; }

	.error { font-family: var(--font-display); font-size: 22px; color: var(--warn); text-align: center; padding: 30px; }
	@media (max-aspect-ratio: 4/3) {
		.dashboard { grid-template-columns: 1fr; grid-template-rows: auto auto; }
		.metrics { flex-direction: row; flex-wrap: wrap; }
	}
</style>
