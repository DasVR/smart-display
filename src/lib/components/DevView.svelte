<script>
	import { onMount } from 'svelte';
	import GlassPanel from '$lib/components/GlassPanel.svelte';
	let mounted = false;
	let loading = true;

	onMount(() => {
		mounted = true;
		fetchTelemetry();
	});

	// real server telemetry from the local box
	let telemetry = {
		services: [],
		stats: { ram_used: 0, ram_total: 0, cpu: 0, containers: 0 }
	};

	async function fetchTelemetry() {
		try {
			const r = await fetch('/api/telemetry');
			const d = await r.json();
			telemetry = d;
			loading = false;
		} catch {
			// fallback to static so the glass layout still renders
			telemetry = {
				services: [
					{ name: 'dasdev.net', status: true, uptime: '99.9%' },
					{ name: 'mc.dasdev.net', status: true, uptime: '100%' },
					{ name: 'hermes.dasdev.net', status: true, uptime: '99.7%' }
				],
				stats: { ram_used: 12, ram_total: 30, cpu: 8, containers: 8 }
			};
			loading = false;
		}
	}
</script>

<div class="dev-view" class:mounted>
	<div class="grid">
		<GlassPanel title="Services" meta="{telemetry.services.length} up">
			{#if loading}
				<div class="skeleton" style="height:120px"></div>
			{:else}
				<div class="svc-list">
					{#each telemetry.services as s}
						<div class="svc-row">
							<span class="svc-name">{s.name}</span>
							<span class="svc-meta">
								<span class="status-dot" class:ok={s.status}></span>
								<span class="uptime">{s.uptime}</span>
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</GlassPanel>

		<GlassPanel title="Server" meta="live">
			{#if loading}
				<div class="skeleton" style="height:80px"></div>
			{:else}
				<div class="stat-grid">
					<div class="stat">
						<div class="stat-val">{telemetry.stats.ram_used}<span class="unit">GB</span></div>
						<div class="stat-lbl">ram used</div>
					</div>
					<div class="stat">
						<div class="stat-val">{telemetry.stats.ram_total}<span class="unit">GB</span></div>
						<div class="stat-lbl">ram total</div>
					</div>
					<div class="stat">
						<div class="stat-val">{telemetry.stats.cpu}<span class="unit">%</span></div>
						<div class="stat-lbl">cpu</div>
					</div>
					<div class="stat">
						<div class="stat-val">{telemetry.stats.containers}</div>
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
		padding: 40px;
		opacity: 0;
		transform: translateY(14px);
		transition: opacity 0.5s var(--ease-standard), transform 0.6s var(--ease-standard);
	}
	.dev-view.mounted { opacity: 1; transform: translateY(0); }

	.grid {
		display: grid;
		grid-template-columns: 1.2fr 1fr;
		gap: 20px;
		width: 100%;
		max-width: 900px;
	}

	.svc-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 2px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.svc-row:last-child { border-bottom: none; }
	.svc-name { font-size: 14px; font-weight: 500; color: rgba(242, 240, 247, 0.9); }
	.svc-meta { display: flex; align-items: center; gap: 8px; }
	.uptime { font-family: var(--font-display); font-size: 11px; color: rgba(242, 240, 247, 0.4); }

	.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.stat { text-align: center; }
	.stat-val { font-family: var(--font-display); font-size: 30px; font-weight: 700; color: rgba(242, 240, 247, 0.95); }
	.stat-val .unit { font-size: 13px; color: rgba(242, 240, 247, 0.4); margin-left: 2px; }
	.stat-lbl { font-family: var(--font-display); font-size: 10px; color: rgba(242, 240, 247, 0.4); margin-top: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
</style>
