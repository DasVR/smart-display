<script>
	import BracketMeter from '$lib/components/BracketMeter.svelte';

	let {
		open = false,
		cpu = 0,
		ram = 0,
		ramHint = '',
		containers = 0,
		net = 0,
		quality = 'full',
		services = [],
		error = ''
	} = $props();

	let down = $derived((services || []).filter((s) => s && !s.status));
	let netHint = $derived(
		Number.isFinite(Number(net)) ? `${Number(net).toFixed(Number(net) >= 10 ? 0 : 1)} Mb/s` : '--'
	);
</script>

<aside class="peek" class:open aria-hidden={!open} aria-label="Host load">
	<p class="kicker">Host</p>
	<p class="qual">{quality}</p>
	<BracketMeter label="CPU" pct={cpu} hint="live" />
	<BracketMeter label="RAM" pct={ram} hint={ramHint} />
	<p class="ctr">{containers} containers · {netHint}</p>
	{#if error}
		<p class="muted">{error}</p>
	{:else if down.length}
		<ul class="svc">
			{#each down as s (s.name)}
				<li>
					<span class="svc-name">{s.name}</span>
					<span class="state">Offline</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">Services up</p>
	{/if}
</aside>

<style>
	.peek {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 2;
		width: min(22rem, 36%);
		padding: var(--space-8) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in srgb, var(--abyss) 22%, transparent) 18%,
			color-mix(in srgb, var(--abyss) 58%, transparent) 70%
		);
		transform: translateX(108%);
		transition: transform 520ms var(--spring-smooth);
		pointer-events: none;
	}
	.peek.open {
		transform: translateX(0);
		pointer-events: auto;
	}
	.kicker {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.qual {
		margin: 0;
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: -0.04em;
		color: var(--foreground);
		text-transform: capitalize;
	}
	.ctr {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
	}
	.svc {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.svc li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--hairline);
		min-height: 2.5rem;
	}
	.svc-name {
		font-size: var(--text-lg);
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.state {
		flex-shrink: 0;
		color: var(--warn);
		font-size: var(--text-sm);
	}
	.muted {
		margin: 0;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}
	@media (prefers-reduced-motion: reduce) {
		.peek {
			transition: none;
		}
	}
</style>
