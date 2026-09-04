<script>
	import ThinkingOrbs from '$lib/components/ThinkingOrbs.svelte';
	import ReasoningCard from '$lib/components/ReasoningCard.svelte';
	import ToolCallCard from '$lib/components/ToolCallCard.svelte';

	let { agents = [], reasoning = null, tools = [] } = $props();
</script>

<section class="monitor" aria-label="Active agents and tool execution">
	<h3 class="section">Active Agents</h3>

	<ul class="agents">
		{#each agents as a, i (a.id)}
			<li style="--i: {i}">
				<ThinkingOrbs phase={a.phase} />
				<div class="meta">
					<div class="name">{a.name}</div>
					<div class="task">
						<span class="phase">{a.phase}</span>
						<span>{a.task}</span>
					</div>
				</div>
			</li>
		{/each}
	</ul>

	{#if reasoning}
		<ReasoningCard
			title={reasoning.title}
			phase={reasoning.phase}
			lines={reasoning.lines}
			open={reasoning.open}
		/>
	{/if}

	<div class="tools">
		{#each tools as t (t.id)}
			<ToolCallCard
				kind={t.kind}
				label={t.label}
				status={t.status}
				output={t.output}
				detail={t.detail}
			/>
		{/each}
	</div>
</section>

<style>
	.monitor {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		min-height: 0;
	}
	.section {
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
		font-style: normal;
		letter-spacing: -0.02em;
		color: var(--text-tertiary);
	}
	.agents {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.agents li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 2.75rem;
		min-width: 0;
		padding: var(--space-4) 0;
		border-bottom: 1px solid var(--hairline);
		background: none;
		box-shadow: none;
		transition: transform 280ms var(--spring-smooth);
	}
	.agents li:active {
		transform: scale(0.98);
	}
	@media (prefers-reduced-motion: no-preference) {
		.agents li {
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
		font-size: var(--text-xl);
		font-weight: 500;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.task {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.phase {
		color: var(--brand);
	}
	.tools {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
</style>
