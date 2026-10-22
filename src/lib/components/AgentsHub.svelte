<!--
	The Agents view: one lane per session, so two Claude Code terminals, a
	Claude Code web session and a Cursor cloud agent are four lanes, with
	Hermes and Ollama when they're at it (src/lib/agentBoard.js). Beside them,
	the box's CPU and RAM as two dithered bars, and nothing else.

	Everything fits the wall without scrolling: at most six lanes (the rest are
	"+N more"), each one line of who and where, one headline, one step, and a
	progress bar when the agent knows how far along it is. One lane gets the
	whole stage, two or three stack, four to six go in two columns.

	Motion is for change only: a lane slides into place when the order changes
	(FLIP), arrives with a short rise and leaves with a fade; the bars dissolve
	between levels in dither. The characters are the only thing alive at rest.
-->
<script>
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import DitherField from '$lib/components/DitherField.svelte';
	import DitherMeter from '$lib/components/DitherMeter.svelte';
	import ThinkingOrbs from '$lib/components/ThinkingOrbs.svelte';
	import AgentCharacter from '$lib/components/AgentCharacter.svelte';
	import { agentRoster, agentSessions, telemetry, pushTelemetrySample } from '$lib/stores.js';
	import { displayQuality } from '$lib/services/ollamaArbiter.js';
	import { agentBoard, boardSummary, elapsed } from '$lib/agentBoard.js';

	let now = $state(Date.now());

	async function fetchTelemetry() {
		try {
			const r = await fetch('/api/telemetry');
			if (r.ok) pushTelemetrySample(await r.json());
		} catch {
			/* the bars hold their last reading */
		}
	}

	onMount(() => {
		fetchTelemetry();
		const tick = setInterval(() => (now = Date.now()), 15000);
		// ?demo=agents pins a made-up board (src/routes/+page.svelte); leave it be
		const demo = new URLSearchParams(window.location.search).has('demo');
		async function pull() {
			if (demo) return;
			try {
				const r = await fetch('/api/agents');
				if (!r.ok) return;
				const data = await r.json();
				if (Array.isArray(data.sessions)) agentSessions.set(data.sessions);
				if (Array.isArray(data.agents) && data.agents.some((a) => Number(a.updatedAt) > 0)) agentRoster.set(data.agents);
			} catch {
				/* the socket keeps them current; this is only a catch-up */
			}
		}
		pull();
		const poll = setInterval(pull, 10000);
		return () => {
			clearInterval(tick);
			clearInterval(poll);
		};
	});

	let board = $derived(agentBoard({ sessions: $agentSessions, roster: $agentRoster, now }));
	let lanes = $derived(board.lanes);
	let layout = $derived(lanes.length <= 1 ? 'solo' : lanes.length <= 3 ? 'stack' : 'grid');
	let charSize = $derived(layout === 'solo' ? 360 : layout === 'stack' ? 150 : 112);
	let busy = $derived(board.counts.working + board.counts.waiting > 0);
	let paused = $derived($displayQuality !== 'full');
	let cpu = $derived(Math.round(Number($telemetry?.stats?.cpu) || 0));
	let ram = $derived($telemetry?.stats?.ram_total ? Math.round(($telemetry.stats.ram_used / $telemetry.stats.ram_total) * 100) : 0);

	const targetOf = (phase) => (phase === 'working' ? 'work' : phase === 'waiting' ? 'ask' : 'idle');
	const stateWord = (l) => ({ working: 'Working', waiting: 'Needs you', error: 'Stopped', done: 'Finished' })[l.phase] || '';
	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const enter = (node) => fly(node, { y: reduce ? 0 : 10, duration: reduce ? 0 : 260, easing: (t) => 1 - Math.pow(1 - t, 3) });
	const leave = (node) => fade(node, { duration: reduce ? 0 : 150 });
</script>

<div class="agents" class:busy data-layout={layout}>
	<DitherField active={busy} {paused} />

	<section class="board" aria-label="Agents">
		<p class="summary" class:attn={board.counts.waiting > 0}>
			{boardSummary(board.counts)}{#if board.more}<span class="more"> · {board.more} more not shown</span>{/if}
		</p>

		{#if lanes.length}
			<ol class="lanes" style:--rows={Math.ceil(lanes.length / 2)}>
				{#each lanes as l (l.key)}
					<li class="lane" data-phase={l.phase} animate:flip={{ duration: reduce ? 0 : 300, easing: (t) => 1 - Math.pow(1 - t, 3) }} in:enter out:leave>
						<div class="who" class:orb={!l.character}>
							{#if l.character}
								<AgentCharacter character={l.character} target={targetOf(l.phase)} size={charSize} {paused} label={`${l.name}: ${stateWord(l).toLowerCase()}`} />
							{:else}
								<ThinkingOrbs phase={l.phase} size={layout === 'solo' ? 'lg' : 'sm'} />
							{/if}
						</div>
						<div class="text">
							<p class="meta">
								<span class="name">{l.name}</span>
								{#if l.where}<span class="where">{l.where}</span>{/if}
								<span class="time">{elapsed(l.phase === 'working' || l.phase === 'waiting' ? l.since : l.at, now)}</span>
							</p>
							<h3 class="headline">{l.headline}</h3>
							<p class="step"><span class="state">{stateWord(l)}</span>{#if l.step}<span class="detail">{l.step}</span>{/if}</p>
							{#if l.progress}
								<div class="progress">
									<div class="bar"><DitherMeter value={(l.progress.done / l.progress.total) * 100} tone={l.phase === 'waiting' ? 'warn' : 'ok'} cell={layout === 'solo' ? 4 : 3} label={`${l.progress.done} of ${l.progress.total} done`} /></div>
									<span class="count">{l.progress.done} of {l.progress.total}</span>
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{:else}
			<div class="quiet" in:enter>
				<p class="quiet-title">No agents running</p>
				<p class="quiet-body">Claude Code, Cursor and Hermes show up here the moment they start.</p>
			</div>
		{/if}
	</section>

	<aside class="vitals" aria-label="This computer">
		<div class="vital">
			<div class="track"><DitherMeter vertical value={cpu} label="CPU" /></div>
			<p class="vital-num">{cpu}<span>%</span></p>
			<p class="vital-label">CPU</p>
		</div>
		<div class="vital">
			<div class="track"><DitherMeter vertical value={ram} label="Memory" /></div>
			<p class="vital-num">{ram}<span>%</span></p>
			<p class="vital-label">RAM</p>
		</div>
	</aside>
</div>

<style>
	.agents {
		position: relative;
		flex: 1;
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-8);
		padding: var(--space-6) var(--space-6) var(--space-6) var(--space-4);
	}
	.board {
		position: relative;
		z-index: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.summary {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 500;
		color: var(--text-tertiary);
		transition: color 200ms ease;
	}
	.summary.attn {
		color: var(--warn);
	}

	/* ---------- lanes ---------- */
	.lanes {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-height: 0;
		display: grid;
		gap: var(--space-4) var(--space-8);
		align-content: start;
	}
	[data-layout='solo'] .lanes {
		align-content: end;
	}
	[data-layout='grid'] .lanes {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-rows: repeat(var(--rows, 3), minmax(0, 1fr));
		grid-auto-flow: column;
	}
	.lane {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
		min-height: 0;
		padding: var(--space-3) var(--space-4) var(--space-3) var(--space-2);
		border-radius: var(--radius-md);
		transition: background-color 200ms ease;
	}
	/* the one thing worth noticing from across the room */
	.lane[data-phase='waiting'] {
		background: color-mix(in srgb, var(--warn) 10%, transparent);
	}
	.lane[data-phase='done'],
	.lane[data-phase='error'] {
		opacity: 0.62;
	}
	.who {
		flex: none;
		display: grid;
		place-items: end center;
	}
	.who.orb {
		width: 112px;
		place-items: center;
	}
	[data-layout='solo'] .who.orb {
		width: 260px;
	}
	.text {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.meta {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		min-width: 0;
		font-size: var(--text-lg);
		color: var(--text-tertiary);
		white-space: nowrap;
	}
	.name {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.where {
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.time {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		flex: none;
	}
	.headline {
		margin: 0;
		font-size: var(--text-3xl);
		font-weight: 650;
		letter-spacing: -0.02em;
		line-height: 1.15;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	[data-layout='solo'] .headline {
		font-size: clamp(2.6rem, 4.6vw, 4.4rem);
		letter-spacing: -0.04em;
		white-space: normal;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	[data-layout='grid'] .headline {
		font-size: var(--text-2xl);
	}
	.step {
		margin: 0;
		display: flex;
		gap: var(--space-3);
		min-width: 0;
		font-size: var(--text-xl);
		white-space: nowrap;
	}
	[data-layout='solo'] .step {
		font-size: var(--text-2xl);
	}
	.state {
		flex: none;
		font-weight: 600;
		color: var(--text-tertiary);
		transition: color 200ms ease;
	}
	.lane[data-phase='working'] .state {
		color: var(--ok);
	}
	.lane[data-phase='waiting'] .state {
		color: var(--warn);
	}
	.lane[data-phase='error'] .state {
		color: var(--warn);
	}
	.detail {
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.progress {
		margin-top: var(--space-2);
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.bar {
		flex: 1;
		max-width: 28rem;
		height: 0.75rem;
	}
	[data-layout='solo'] .bar {
		height: 1rem;
	}
	.count {
		flex: none;
		font-size: var(--text-base);
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.more {
		color: var(--text-tertiary);
	}

	/* ---------- nobody at it ---------- */
	.quiet {
		margin-top: auto;
		margin-bottom: var(--space-6);
	}
	.quiet-title {
		margin: 0;
		font-size: clamp(2.4rem, 4.4vw, 4rem);
		font-weight: 650;
		letter-spacing: -0.04em;
		color: var(--text-secondary);
	}
	.quiet-body {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xl);
		color: var(--text-tertiary);
	}

	/* ---------- the box ---------- */
	.vitals {
		position: relative;
		z-index: 1;
		display: flex;
		gap: var(--space-5);
		min-height: 0;
	}
	.vital {
		width: 3rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		min-height: 0;
	}
	.track {
		flex: 1;
		width: 100%;
		min-height: 0;
	}
	.vital-num {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	.vital-num span {
		font-size: var(--text-base);
		color: var(--text-tertiary);
	}
	.vital-label {
		margin: 0;
		font-size: var(--text-base);
		color: var(--text-tertiary);
	}

	@media (prefers-reduced-motion: reduce) {
		.lane,
		.state,
		.summary {
			transition: none;
		}
	}
</style>
