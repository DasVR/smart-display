<!--
	GitHub Pages demo only: a small picker for the preview states the kiosk
	already supports through query parameters (see README "Preview URLs").
-->
<script>
	import { base } from '$app/paths';

	const SCENARIOS = [
		{ q: '', label: 'Live dashboard', hint: 'Clock, weather, radar, trough' },
		{ q: 'demo=music', label: 'Music + lyrics', hint: 'Word-synced lyrics, album glow' },
		{ q: 'demo=voices', label: 'Duet lyrics', hint: 'Call-and-response voices' },
		{ q: 'demo=agents', label: 'Agents at work', hint: 'Coding agents and host load' },
		{ q: 'standby=1', label: 'StandBy night', hint: 'Red night clock' },
		{ q: 'wx=warning', label: 'Tornado warning', hint: 'Severe alert in the island' },
		{ q: 'wx=rain', label: 'Rain incoming', hint: 'Nowcast in the island' },
		{ q: 'island=install', label: 'Installing update', hint: 'Island + progress orb' },
		{ q: 'wx=notify', label: 'Agent finished', hint: 'Notification slip' }
	];

	let open = $state(false);
	let current = $state('');
	if (typeof window !== 'undefined') current = window.location.search.replace(/^\?/, '');

	function href(q) {
		return `${base}/${q ? `?${q}` : ''}`;
	}
</script>

<div class="demo" class:open data-no-swipe>
	{#if open}
		<div class="sheet-panel" role="dialog" aria-label="Demo scenarios">
			<p class="head">Smart Display demo</p>
			<p class="sub">Canned data, no server. Swipe or press ← → to change views.</p>
			<ul>
				{#each SCENARIOS as s (s.q)}
					<li>
						<a href={href(s.q)} class:active={current === s.q} data-sveltekit-reload>
							<span class="label">{s.label}</span>
							<span class="hint">{s.hint}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	<button class="pill" onclick={() => (open = !open)} aria-expanded={open}>
		<span class="dot" aria-hidden="true"></span>
		{open ? 'Close' : 'Demo'}
	</button>
</div>

<style>
	.demo {
		position: fixed;
		left: var(--space-4);
		bottom: var(--space-4);
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		font-family: var(--font-body);
		font-size: 0.7rem;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: 999px;
		background: color-mix(in srgb, var(--abyss) 72%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		color: var(--text-secondary);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		transition-property: transform, color;
		transition-duration: 150ms;
	}
	.pill:hover {
		color: var(--foreground);
	}
	.pill:active {
		transform: scale(0.96);
	}
	.dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--brand);
		box-shadow: 0 0 8px var(--brand);
	}
	.sheet-panel {
		width: min(18rem, calc(100vw - 2rem));
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--abyss-1) 88%, transparent);
		backdrop-filter: blur(18px) saturate(1.3);
		-webkit-backdrop-filter: blur(18px) saturate(1.3);
		box-shadow: 0 18px 40px color-mix(in srgb, var(--abyss) 70%, transparent);
		animation: panel-in 220ms var(--spring-smooth) both;
	}
	@keyframes panel-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	.head {
		margin: 0;
		font-weight: 700;
		color: var(--foreground);
	}
	.sub {
		margin: 0.2rem 0 var(--space-2);
		color: var(--text-tertiary);
		line-height: 1.35;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	a {
		display: grid;
		padding: 0.4rem 0.55rem;
		border-radius: calc(var(--radius-md) - var(--space-3) + 0.2rem);
		color: var(--text-secondary);
		text-decoration: none;
		transition-property: background-color, color;
		transition-duration: 150ms;
	}
	a:hover {
		background: color-mix(in srgb, var(--foreground) 6%, transparent);
		color: var(--foreground);
	}
	a.active {
		background: color-mix(in srgb, var(--brand) 16%, transparent);
		color: var(--foreground);
	}
	.label {
		font-weight: 600;
	}
	.hint {
		color: var(--text-tertiary);
	}
</style>
