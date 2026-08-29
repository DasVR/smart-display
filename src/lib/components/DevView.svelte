<script>
	import { recentCommits } from '$lib/stores.js';
	import { onMount } from 'svelte';
	let mounted = false;
	onMount(() => { mounted = true; });

	const services = [
		{ name: 'dasdev.net', status: 'up', uptime: '99.9%' },
		{ name: 'hermes.dasdev.net', status: 'up', uptime: '99.7%' },
		{ name: 'mc.dasdev.net', status: 'up', uptime: '100%' },
		{ name: 'notify.dasdev.net', status: 'up', uptime: '99.8%' },
	];
	const commits = [
		{ repo: 'finn-pentest-harness', msg: 'add godmode pipeline v2', time: '2h ago' },
		{ repo: 'portfolio-v2', msg: 'fix mobile nav overflow', time: '5h ago' },
		{ repo: 'leadvine', msg: 'scraper retry logic', time: '1d ago' },
	];
</script>

<div class="dev-view" class:mounted>
	<div class="header">
		<h2>Dev Wall</h2>
		<div class="meta">{services.length} services online</div>
	</div>
	<div class="grid">
		<div class="panel services">
			<div class="panel-title">Services</div>
			{#each services as s, i}
				<div class="svc-row" style="transition-delay: {i*50}ms">
					<div class="svc-name">{s.name}</div>
					<div class="svc-meta">
						<span class="dot" class:up={s.status==='up'}></span>
						<span class="uptime">{s.uptime}</span>
					</div>
				</div>
			{/each}
		</div>
		<div class="panel commits">
			<div class="panel-title">Recent Commits</div>
			{#each commits as c, i}
				<div class="commit-row" style="transition-delay: {i*50}ms">
					<div class="commit-repo">{c.repo}</div>
					<div class="commit-msg">{c.msg}</div>
					<div class="commit-time">{c.time}</div>
				</div>
			{/each}
		</div>
		<div class="panel stats">
			<div class="panel-title">Server</div>
			<div class="stat-grid">
				<div class="stat"><div class="stat-val">12</div><div class="stat-lbl">GB used</div></div>
				<div class="stat"><div class="stat-val">17</div><div class="stat-lbl">GB free</div></div>
				<div class="stat"><div class="stat-val">8</div><div class="stat-lbl">containers</div></div>
				<div class="stat"><div class="stat-val">30</div><div class="stat-lbl">GB ram</div></div>
			</div>
		</div>
	</div>
</div>

<style>
	.dev-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 80px 60px 40px;
		gap: 28px;
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.22,1,0.36,1);
	}
	.dev-view.mounted { opacity: 1; transform: translateY(0); }

	.header { display: flex; justify-content: space-between; align-items: baseline; }
	.header h2 {
		font-size: clamp(28px, 3vw, 40px);
		font-weight: 600;
		letter-spacing: -0.02em;
		margin: 0;
		background: linear-gradient(90deg, #10b981, #00d992);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	.meta {
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		color: rgba(255,255,255,0.25);
		letter-spacing: 0.05em;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 16px;
		flex: 1;
		min-height: 0;
	}
	.panel {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 20px;
		padding: 24px;
		overflow: hidden;
	}
	.panel-title {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: rgba(255,255,255,0.25);
		margin-bottom: 16px;
		font-family: 'JetBrains Mono', monospace;
	}
	.services { grid-row: 1 / 3; }
	.stats { grid-column: 2; grid-row: 2; }

	.svc-row, .commit-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 0;
		border-bottom: 1px solid rgba(255,255,255,0.04);
		transition: background 0.15s;
		opacity: 0;
		transform: translateX(-8px);
	}
	.dev-view.mounted .svc-row,
	.dev-view.mounted .commit-row {
		opacity: 1;
		transform: translateX(0);
		transition: opacity 0.3s ease, transform 0.3s ease, background 0.15s;
	}
	.svc-row:hover, .commit-row:hover { background: rgba(255,255,255,0.02); }
	.svc-name { font-size: 14px; font-weight: 500; color: #f5f2ec; }
	.svc-meta { display: flex; align-items: center; gap: 8px; }
	.dot { width: 6px; height: 6px; border-radius: 50%; background: #444; }
	.dot.up { background: #00d992; box-shadow: 0 0 6px #00d99250; }
	.uptime { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255,255,255,0.25); }

	.commit-repo { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255,255,255,0.35); margin-bottom: 2px; }
	.commit-msg { font-size: 14px; color: #f5f2ec; }
	.commit-time { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255,255,255,0.2); }

	.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.stat { text-align: center; }
	.stat-val { font-size: 32px; font-weight: 700; color: #f5f2ec; font-family: 'JetBrains Mono', monospace; }
	.stat-lbl { font-size: 11px; color: rgba(255,255,255,0.25); margin-top: 4px; letter-spacing: 0.05em; text-transform: uppercase; }
</style>
