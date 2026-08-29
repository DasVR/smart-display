<script>
	import { onMount } from 'svelte';
	import { recentCommits } from '$lib/stores.js';
	let mounted = false;
	let loading = true;
	onMount(() => {
		mounted = true;
		setTimeout(() => { loading = false; }, 700);
	});

	// PLACEHOLDER until wired to uptime-kuma / github / prometheus
	const services = [
		{ name: 'dasdev.net', status: true, uptime: '99.9%' },
		{ name: 'mc.dasdev.net', status: true, uptime: '100%' },
		{ name: 'hermes.dasdev.net', status: true, uptime: '99.7%' }
	];
	const commits = [
		{ repo: 'smart-display', msg: 'token-system redesign pass', time: 'now' },
		{ repo: 'portfolio-v2', msg: 'mobile nav overflow fix', time: '5h' },
		{ repo: 'leadvine', msg: 'scraper retry logic', time: '1d' }
	];
</script>

<div class="view-shell dev-view" class:mounted>
	<div class="view-head">
		<h2 class="view-title">Dev</h2>
		<div class="view-meta">{services.length} up</div>
	</div>

	{#if loading}
		<div class="grid">
			<div class="panel skeleton"></div>
			<div class="panel skeleton"></div>
			<div class="panel skeleton"></div>
		</div>
	{:else}
		<div class="grid">
			<section class="panel">
				<h3 class="panel-title">Services</h3>
				<div class="svc-list">
					{#each services as s}
						<div class="svc-row">
							<span class="svc-name">{s.name}</span>
							<span class="svc-meta">
								<span class="status-dot" class:ok={s.status}></span>
								<span class="uptime">{s.uptime}</span>
							</span>
						</div>
					{/each}
				</div>
			</section>

			<section class="panel">
				<h3 class="panel-title">Commits</h3>
				<div class="commit-list">
					{#each commits as c}
						<div class="commit-row">
							<div class="commit-top">
								<span class="commit-repo">{c.repo}</span>
								<span class="commit-time">{c.time}</span>
							</div>
							<div class="commit-msg">{c.msg}</div>
						</div>
					{/each}
				</div>
			</section>

			<section class="panel">
				<h3 class="panel-title">Server</h3>
				<div class="stat-grid">
					<div class="stat"><div class="stat-val">12</div><div class="stat-lbl">GB used</div></div>
					<div class="stat"><div class="stat-val">17</div><div class="stat-lbl">GB free</div></div>
					<div class="stat"><div class="stat-val">8</div><div class="stat-lbl">containers</div></div>
					<div class="stat"><div class="stat-val">30</div><div class="stat-lbl">GB ram</div></div>
				</div>
			</section>
		</div>
	{/if}
</div>

<style>
	.dev-view { gap: 20px; }
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr auto;
		gap: 14px;
		flex: 1;
		min-height: 0;
	}
	.panel:first-child { grid-row: span 2; }

	.svc-row, .commit-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 2px;
		border-bottom: 1px solid var(--surface-border);
	}
	.svc-list .svc-row:last-child,
	.commit-list .commit-row:last-child { border-bottom: none; }
	.svc-name { font-size: 14px; font-weight: 500; color: var(--text-primary); }
	.svc-meta { display: flex; align-items: center; gap: 8px; }
	.uptime { font-family: var(--font-display); font-size: 11px; color: var(--text-tertiary); }

	.commit-row { flex-direction: column; align-items: flex-start; gap: 4px; }
	.commit-top { width: 100%; display: flex; justify-content: space-between; }
	.commit-repo { font-family: var(--font-display); font-size: 11px; color: var(--accent); }
	.commit-time { font-family: var(--font-display); font-size: 11px; color: var(--text-tertiary); }
	.commit-msg { font-size: 14px; color: var(--text-primary); }

	.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
	.stat { text-align: center; }
	.stat-val { font-family: var(--font-display); font-size: 30px; font-weight: 700; color: var(--text-primary); }
	.stat-lbl { font-family: var(--font-display); font-size: 10px; color: var(--text-tertiary); margin-top: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
</style>
