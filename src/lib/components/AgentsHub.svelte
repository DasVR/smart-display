<script>
	import { onMount } from 'svelte';
	import ThinkingOrbs from '$lib/components/ThinkingOrbs.svelte';
	import { agentRoster } from '$lib/stores.js';
	import { relativeAge, workingAgents } from '$lib/agentRoster.js';

	let now = $state(Date.now());

	onMount(() => {
		const t = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(t);
	});

	let working = $derived(workingAgents($agentRoster).length);
	let headline = $derived(working === 1 ? '1 working' : working > 1 ? `${working} working` : 'All idle');
</script>

<div class="agents-hub">
	<div class="mark">
		<span class="ctr">{headline}</span>
	</div>

	<ul class="roster" aria-label="Claude Code, Cursor, Hermes, and Ollama">
		{#each $agentRoster as a, i (a.id)}
			<li data-phase={a.phase} style="--i: {i}">
				<ThinkingOrbs phase={a.phase} />
				<div class="meta">
					<div class="name">{a.name}</div>
					<div class="task">
						<span class="phase">{a.phase}</span>
						<span>{a.task}</span>
					</div>
				</div>
				<time class="age" datetime={a.updatedAt ? new Date(a.updatedAt).toISOString() : undefined}>
					{relativeAge(a.updatedAt, now)}
				</time>
			</li>
		{/each}
	</ul>

	<p class="hint">
		Ping <code>working</code> when a run starts and <code>done</code> when it finishes.
		Claude Code hooks and <code>hooks/display-done.sh</code> already do this.
	</p>
</div>

<style>
	.agents-hub {
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
		align-items: baseline;
		justify-content: flex-end;
		flex-shrink: 0;
	}
	.ctr {
		font-family: var(--font-body);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.roster {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
		flex: 1;
		min-height: 0;
	}
	.roster li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 4.25rem;
		min-width: 0;
		padding: var(--space-5) 0;
		border-bottom: 1px solid var(--hairline);
		background: none;
		box-shadow: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.roster li {
			animation: today-arrive 560ms var(--spring-smooth) both;
			animation-delay: calc(var(--i, 0) * 70ms);
		}
	}
	.meta {
		min-width: 0;
		flex: 1;
	}
	.name {
		font-family: var(--font-body);
		font-size: var(--text-2xl);
		font-weight: 600;
		letter-spacing: -0.03em;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.task {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--text-base);
		color: var(--text-tertiary);
	}
	.phase {
		color: var(--brand);
		text-transform: lowercase;
	}
	.roster li[data-phase='working'] .phase {
		color: var(--ok);
	}
	.roster li[data-phase='done'] .phase {
		color: var(--scan);
	}
	.age {
		flex-shrink: 0;
		font-family: var(--font-body);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		max-width: 42rem;
	}
	.hint code {
		font-family: var(--font-code);
		font-size: 0.92em;
		color: var(--text-secondary);
	}
</style>
