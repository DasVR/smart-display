<script>
	import { wsStatus } from '$lib/stores.js';
	import { onMount } from 'svelte';
	let telemetry = { stats: {}, services: [] };

	onMount(() => {
		fetchTelemetry();
		const t = setInterval(fetchTelemetry, 5000);
		return () => clearInterval(t);
	});

	async function fetchTelemetry() {
		try {
			const r = await fetch('/api/telemetry');
			if (!r.ok) return;
			telemetry = await r.json();
		} catch {}
	}
</script>

<div class="topbar-grid">
	<div class="cell status-cell">
		<div class="label">agent link</div>
		<div class="value" class:ok={$wsStatus === 'connected'}>{$wsStatus === 'connected' ? 'online' : 'offline'}</div>
	</div>
	<div class="cell">
		<div class="label">CPU</div>
		<div class="value">{telemetry?.stats?.cpu ?? '--'}%</div>
	</div>
	<div class="cell">
		<div class="label">RAM</div>
		<div class="value">{telemetry?.stats?.ram_used ?? '--'}/{telemetry?.stats?.ram_total ?? '--'} GB</div>
	</div>
	<div class="cell">
		<div class="label">containers</div>
		<div class="value">{telemetry?.stats?.containers ?? '--'}</div>
	</div>
	<div class="cell wide">
		<div class="label">services</div>
		<div class="service-row">
			{#each telemetry?.services || [] as s}
				<span class="svc-dot" class:ok={s.status}>{s.name}</span>
			{/each}
		</div>
	</div>
</div>

<style>
	.topbar-grid {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: 18px;
		padding: 28px;
	}
	.cell {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.05);
		border-radius: var(--r-md);
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.cell.wide { grid-column: span 2; }
	.label {
		font-family: var(--font-display);
		font-size: 13px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		margin-bottom: 8px;
	}
	.value {
		font-family: var(--font-display);
		font-size: clamp(26px, 2.4vw, 40px);
		font-weight: 600;
		color: var(--text-primary);
		line-height: 1.1;
	}
	.value.ok { color: var(--ok); text-shadow: 0 0 18px rgba(52,211,153,0.3); }
	.service-row {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.svc-dot {
		font-size: 13px;
		font-family: var(--font-display);
		padding: 5px 10px;
		border-radius: 999px;
		background: rgba(255,255,255,0.05);
		color: var(--text-tertiary);
		border: 1px solid rgba(255,255,255,0.06);
	}
	.svc-dot.ok {
		background: rgba(52,211,153,0.12);
		color: var(--ok);
		border-color: rgba(52,211,153,0.2);
	}
</style>
