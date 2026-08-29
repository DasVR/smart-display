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

	function fmtUptime(s) {
		if (!s) return '-';
		return s;
	}
</script>

<div class="dev-view" class:mounted>
	<div class="grid">
		<GlassPanel title="Services" meta="live">
			{#if loading}
				<div class="skeleton" style="height:160px"></div>
			{:else if error}
				<div class="error">{error}</div>
			{:else}
				<div class="svc-list">
					{#each telemetry.services || [] as s}
						<div class="svc-row">
							<div class="svc-left">
								<span class="status-pill" class:ok={s.status}>{s.status ? 'up' : 'down'}</span>
								<span class="svc-name">{s.name}</span>
							</div>
							<span class="uptime">{fmtUptime(s.uptime)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</GlassPanel>

		<GlassPanel title="Server" meta="{telemetry?.stats?.cpu ?? 0}% cpu">
			{#if loading}
				<div class="skeleton" style="height:120px"></div>
			{:else}
				<div class="stat-grid">
					<div class="stat">
						<div class="stat-val">{telemetry?.stats?.ram_used ?? '--'}<span class="unit">GB</span></div>
						<div class="stat-lbl">used</div>
					</div>
					<div class="stat">
						<div class="stat-val">{telemetry?.stats?.ram_total ?? '--'}<span class="unit">GB</span></div>
						<div class="stat-lbl">total</div>
					</div>
					<div class="stat">
						<div class="stat-val">{telemetry?.stats?.cpu ?? 0}<span class="unit">%</span></div>
						<div class="stat-lbl">cpu</div>
					</div>
					<div class="stat">
						<div class="stat-val">{telemetry?.stats?.containers ?? '--'}</div>
						<div class="stat-lbl">containers</div>
					</div>
				</div>
			{/if}
		</GlassPanel>
	</div>
</div>

<style>
	.dev-view {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 60px;
		opacity: 0;
		transform: translateY(14px);
		transition: opacity 0.5s var(--ease-standard), transform 0.6s var(--ease-standard);
	}
	.dev-view.mounted { opacity: 1; transform: translateY(0); }

	.grid {
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 28px;
		width: 100%;
		max-width: 1200px;
	}

	.svc-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px 2px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.svc-row:last-child { border-bottom: none; }
	.svc-left { display: flex; align-items: center; gap: 14px; }
	.status-pill {
		font-family: var(--font-display);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 5px 10px;
		border-radius: var(--r-sm);
		background: rgba(255,255,255,0.07);
		color: var(--text-tertiary);
		border: 1px solid rgba(255,255,255,0.09);
	}
	.status-pill.ok {
		background: rgba(52,211,153,0.14);
		color: var(--ok);
		border-color: rgba(52,211,153,0.28);
		box-shadow: 0 0 12px rgba(52,211,153,0.18);
	}
	.svc-name { font-size: 20px; font-weight: 500; color: rgba(242, 240, 247, 0.92); }
	.uptime { font-family: var(--font-display); font-size: 14px; color: rgba(242, 240, 247, 0.4); }

	.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
	.stat { text-align: center; }
	.stat-val { font-family: var(--font-display); font-size: 42px; font-weight: 700; color: rgba(242, 240, 247, 0.96); line-height: 1; }
	.stat-val .unit { font-size: 18px; color: rgba(242, 240, 247, 0.4); margin-left: 4px; }
	.stat-lbl { font-family: var(--font-display); font-size: 13px; color: rgba(242, 240, 247, 0.4); margin-top: 8px; letter-spacing: 0.06em; text-transform: uppercase; }
	.error { font-family: var(--font-display); font-size: 16px; color: var(--warn); text-align: center; padding: 20px; }
</style>
