<script>
	import { onMount } from 'svelte';
	import ThinkingOrbs from '$lib/components/ThinkingOrbs.svelte';
	import DitherField from '$lib/components/DitherField.svelte';
	import HostPeek from '$lib/components/HostPeek.svelte';
	import { agentRoster, telemetry, pushTelemetrySample } from '$lib/stores.js';
	import { displayQuality } from '$lib/services/ollamaArbiter.js';
	import { hostPeekNeeded } from '$lib/hostPeek.js';
	import { leadAgent, relativeAge } from '$lib/agentRoster.js';

	let now = $state(Date.now());
	let pinned = $state(false);
	let loading = $state(true);
	let error = $state('');

	function rosterHasSignal(list) {
		return (list || []).some((a) => Number(a.updatedAt) > 0);
	}

	function forcePeek() {
		if (typeof window === 'undefined') return false;
		return new URLSearchParams(window.location.search).get('peek') === '1';
	}

	async function fetchTelemetry() {
		try {
			const r = await fetch('/api/telemetry');
			if (!r.ok) throw new Error('telemetry failed');
			pushTelemetrySample(await r.json());
			error = '';
		} catch {
			error = 'live feed offline';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchTelemetry();
		const tick = setInterval(() => {
			now = Date.now();
		}, 1000);
		async function pull() {
			try {
				const r = await fetch('/api/agents');
				if (!r.ok) return;
				const data = await r.json();
				if (!Array.isArray(data.agents) || !rosterHasSignal(data.agents)) return;
				agentRoster.set(data.agents);
			} catch {
				/* agents endpoint is optional in vite */
			}
		}
		pull();
		const poll = setInterval(pull, 2500);
		return () => {
			clearInterval(tick);
			clearInterval(poll);
		};
	});

	let lead = $derived(leadAgent($agentRoster));
	let others = $derived($agentRoster.filter((a) => a.id !== lead?.id));
	let thinking = $derived(lead?.phase === 'working');
	let paused = $derived($displayQuality !== 'full');
	let ramPct = $derived(
		$telemetry?.stats?.ram_total
			? Math.round(($telemetry.stats.ram_used / $telemetry.stats.ram_total) * 100)
			: 0
	);
	let cpuPct = $derived($telemetry?.stats?.cpu ?? 0);
	let containers = $derived($telemetry?.stats?.containers ?? 0);
	let netMbps = $derived($telemetry?.stats?.net_mbps ?? 0);
	let services = $derived($telemetry?.services ?? []);
	let ramHint = $derived(
		`${$telemetry?.stats?.ram_used ?? '--'} / ${$telemetry?.stats?.ram_total ?? '--'} GB`
	);
	let needed = $derived(
		hostPeekNeeded({
			cpu: cpuPct,
			ramPct,
			quality: $displayQuality,
			services,
			error: Boolean(error),
			force: forcePeek()
		})
	);
	let peekOpen = $derived(pinned || needed);
	let kicker = $derived(
		!lead ? 'Standby' : lead.phase === 'working' ? 'Thinking' : lead.phase === 'done' ? 'Finished' : lead.phase
	);
	let title = $derived(lead?.name || 'Agents');
	let body = $derived(lead?.task && lead.task !== 'standby' ? lead.task : thinking ? 'Working' : 'No run on the box');
</script>

<div class="agents-stage" class:peeking={peekOpen} data-phase={lead?.phase || 'idle'}>
	<DitherField active={thinking} {paused} />

	<div class="think" aria-hidden="true">
		<ThinkingOrbs phase={lead?.phase || 'idle'} size="lg" />
	</div>

	<div class="hero">
		<p class="kicker">{kicker}</p>
		<h2 class="name">{title}</h2>
		<p class="task">{body}</p>
		{#if lead?.updatedAt}
			<time class="age" datetime={new Date(lead.updatedAt).toISOString()}>
				{relativeAge(lead.updatedAt, now)}
			</time>
		{/if}
	</div>

	<ul class="strip" aria-label="Other agents">
		{#each others as a (a.id)}
			<li data-phase={a.phase}>
				<ThinkingOrbs phase={a.phase} />
				<div class="meta">
					<div class="strip-name">{a.name}</div>
					<div class="strip-task">{a.phase} · {a.task}</div>
				</div>
			</li>
		{/each}
	</ul>

	<button
		class="rail"
		class:lit={peekOpen}
		onclick={() => (pinned = !pinned)}
		aria-pressed={peekOpen}
		aria-label={peekOpen ? 'Hide host stats' : 'Show host stats'}
	></button>

	<HostPeek
		open={peekOpen}
		cpu={loading ? 0 : cpuPct}
		ram={loading ? 0 : ramPct}
		{ramHint}
		{containers}
		net={loading ? 0 : netMbps}
		quality={$displayQuality}
		{services}
		{error}
	/>
</div>

<style>
	.agents-stage {
		position: relative;
		flex: 1;
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		padding: var(--space-6) var(--space-2) var(--space-4) 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}
	.think {
		position: absolute;
		z-index: 1;
		left: 0;
		top: 8%;
		pointer-events: none;
	}
	.hero {
		position: relative;
		z-index: 1;
		max-width: min(46rem, 72%);
		padding-bottom: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		transition: max-width 520ms var(--spring-smooth);
	}
	.agents-stage.peeking .hero,
	.agents-stage.peeking .strip {
		max-width: min(42rem, 56%);
	}
	.kicker {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 500;
		letter-spacing: -0.02em;
		color: var(--text-tertiary);
	}
	.agents-stage[data-phase='working'] .kicker {
		color: var(--ok);
	}
	.agents-stage[data-phase='done'] .kicker {
		color: var(--scan);
	}
	.name {
		margin: 0;
		font-family: var(--font-body);
		font-size: clamp(2.6rem, 6vw, 5.2rem);
		font-weight: 700;
		letter-spacing: -0.05em;
		line-height: 0.92;
		color: var(--foreground);
		overflow-wrap: anywhere;
	}
	.task {
		margin: 0;
		font-size: clamp(1.15rem, 2.2vw, 1.75rem);
		color: var(--text-secondary);
		max-width: 28rem;
		overflow-wrap: anywhere;
	}
	.age {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.strip {
		position: relative;
		z-index: 1;
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
		max-width: min(46rem, 72%);
		transition: max-width 520ms var(--spring-smooth);
	}
	.strip li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
		opacity: 0.72;
	}
	.strip li[data-phase='working'] {
		opacity: 1;
	}
	.meta {
		min-width: 0;
	}
	.strip-name {
		font-size: var(--text-lg);
		font-weight: 500;
		color: var(--foreground);
		overflow-wrap: anywhere;
	}
	.strip-task {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
	}
	.rail {
		position: absolute;
		top: 18%;
		right: 0;
		bottom: 18%;
		width: 1.1rem;
		z-index: 3;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
	}
	.rail::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0.35rem;
		width: 2px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 18%, transparent);
	}
	.rail.lit::before {
		background: color-mix(in srgb, var(--brand) 70%, transparent);
		box-shadow: 0 0 12px color-mix(in srgb, var(--brand) 40%, transparent);
	}
	@media (prefers-reduced-motion: reduce) {
		.hero,
		.strip {
			transition: none;
		}
	}
</style>
