<script>
	import ThinkingOrbs from '$lib/components/ThinkingOrbs.svelte';
	import BrailleSpinner from '$lib/components/BrailleSpinner.svelte';
	import BitstreamTicker from '$lib/components/BitstreamTicker.svelte';
	import ReasoningCard from '$lib/components/ReasoningCard.svelte';
	import ToolCallCard from '$lib/components/ToolCallCard.svelte';
	import { runPid } from '$lib/agentFeed.js';

	let { agents = [], reasoning = null, tools = [], seed = 0 } = $props();

	function phaseBadge(phase) {
		switch (phase) {
			case 'searching':
				return 'SCAN';
			case 'solving':
				return 'SOLVE';
			case 'reasoning':
				return 'THINK';
			case 'working':
				return 'RUN';
			case 'executing':
				return 'EXEC';
			case 'idle':
				return 'IDLE';
			case 'done':
				return 'DONE';
			default: {
				const _exhaustive = phase;
				return String(_exhaustive || 'IDLE');
			}
		}
	}
</script>

<section class="monitor" aria-label="Active agents and tool execution">
	<h3 class="section">
		<span>Active Agents</span>
		<span class="pid">[RUN_PID:{runPid('wall')}]</span>
	</h3>

	<ul class="agents">
		{#each agents as a (a.id)}
			<li data-phase={a.phase}>
				<ThinkingOrbs phase={a.phase} />
				<div class="meta">
					<div class="name">
						<BrailleSpinner active={a.phase !== 'idle' && a.phase !== 'done'} />
						<span>{a.name}</span>
						<BitstreamTicker seed={seed + Number(a.pid)} active={a.phase !== 'idle' && a.phase !== 'done'} />
					</div>
					{#if a.branch}
						<p class="branch" title={a.branch}>{a.branch}</p>
					{/if}
					<div class="task">
						<span>{a.task}</span>
						<span class="pid">::{a.pid}</span>
					</div>
				</div>
				<span class="badge">{phaseBadge(a.phase)}</span>
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
		height: 100%;
	}
	.section {
		margin: 0;
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		flex: 0 0 auto;
		font-size: var(--type-floor);
		font-weight: 500;
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
		flex: 1 1 auto;
		min-height: 0;
	}
	.agents li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 72px;
		flex: 1 1 0;
		min-width: 0;
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--card) 55%, transparent);
	}
	.agents li[data-phase='searching'],
	.agents li[data-phase='working'],
	.agents li[data-phase='executing'] {
		border-color: color-mix(in srgb, var(--scan) 40%, var(--border));
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
		font-size: 18px;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.branch {
		margin: 4px 0 0;
		overflow: hidden;
		font-family: var(--font-code);
		font-size: 20px;
		font-weight: 600;
		line-height: 1.15;
		color: var(--foreground);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.task {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: 2px;
		font-size: var(--type-floor);
		color: var(--text-tertiary);
	}
	.badge {
		flex: 0 0 auto;
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--foreground);
		background: var(--card);
	}
	.agents li[data-phase='searching'] .badge,
	.agents li[data-phase='working'] .badge,
	.agents li[data-phase='executing'] .badge {
		border-color: color-mix(in srgb, var(--scan) 50%, var(--border));
		color: var(--scan);
	}
	.agents li[data-phase='solving'] .badge,
	.agents li[data-phase='reasoning'] .badge {
		border-color: color-mix(in srgb, var(--solve) 50%, var(--border));
		color: var(--solve);
	}
	.tools {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 0 0 auto;
	}
</style>
