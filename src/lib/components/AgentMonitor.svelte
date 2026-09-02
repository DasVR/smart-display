<script>
	import ThinkingOrbs from '$lib/components/ThinkingOrbs.svelte';
	import BrailleSpinner from '$lib/components/BrailleSpinner.svelte';
	import BitstreamTicker from '$lib/components/BitstreamTicker.svelte';
	import ReasoningCard from '$lib/components/ReasoningCard.svelte';
	import ToolCallCard from '$lib/components/ToolCallCard.svelte';
	import { runPid } from '$lib/agentFeed.js';

	let { agents = [], reasoning = null, tools = [], seed = 0 } = $props();
</script>

<section class="monitor" aria-label="Active agents and tool execution">
	<h3 class="section">
		<span>Active Agents</span>
		<span class="pid">[RUN_PID:{runPid('wall')}]</span>
	</h3>

	<ul class="agents">
		{#each agents as a (a.id)}
			<li class="plate">
				<ThinkingOrbs phase={a.phase} />
				<div class="meta">
					<div class="name">
						<BrailleSpinner active={a.phase !== 'idle' && a.phase !== 'done'} />
						<span>{a.name}</span>
						<BitstreamTicker seed={seed + Number(a.pid)} active={a.phase !== 'idle' && a.phase !== 'done'} />
					</div>
					<div class="task">
						<span class="phase">{a.phase}</span>
						<span>{a.task}</span>
						<span class="pid">::{a.pid}</span>
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
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		font-size: var(--text-2xl);
		font-weight: 700;
		font-style: normal;
		color: var(--text-tertiary);
	}
	.pid {
		font-family: var(--font-code);
		color: var(--text-tertiary);
	}
	.agents {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.agents li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 4.5rem;
		min-width: 0;
		padding: 0 var(--space-4);
		transition: transform 500ms var(--ease-fluid);
	}
	.agents li:active {
		transform: scale(0.98);
	}
	.meta {
		min-width: 0;
		flex: 1;
	}
	.name {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-xl);
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
