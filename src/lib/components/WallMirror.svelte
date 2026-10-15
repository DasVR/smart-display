<!--
	The phone's Now pane: what the wall is showing this second, in a few
	lines, with that view's buttons under it (src/lib/wallMirror.js). A tapped
	button turns into its result in place ("Done ✓") rather than a toast
	somewhere else, and the row leaves once the wall agrees.
-->
<script>
	import { slide } from 'svelte/transition';
	import { mirrorFor } from '$lib/wallMirror.js';

	let { view = 'clock', ledger = null, nowPlaying = null, weather = null, now = Date.now(), onaction = () => {} } = $props();

	let mirror = $derived(mirrorFor({ view, ledger, nowPlaying, weather, now }));
	// what was just tapped: key -> result label, cleared after a moment
	let sent = $state({});
	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const rowIn = { duration: reduce ? 0 : 180 };

	const keyOf = (a) => `${a.kind}:${a.op || a.decision || a.action || ''}:${a.id || ''}`;
	const RESULT = { done: 'Done ✓', snooze: 'Later ✓', allow: 'Allowed', deny: 'Denied', ack: 'Got it ✓' };

	function tap(a) {
		const key = keyOf(a);
		if (sent[key]) return;
		onaction(a);
		if (a.kind === 'player') return; // the track itself changes; no label to hold
		sent = { ...sent, [key]: RESULT[a.op || a.decision || a.kind] || 'Sent ✓' };
		setTimeout(() => {
			const { [key]: _, ...rest } = sent;
			sent = rest;
		}, 2500);
	}
</script>

<section class="mirror" aria-labelledby="mirror-title" aria-live="polite">
	<header>
		<p class="kicker">On the wall</p>
		<h2 id="mirror-title">{mirror.title}</h2>
	</header>

	{#if mirror.rows.length}
		<ul>
			{#each mirror.rows as r (r.id)}
				<li class:calling={r.calling} transition:slide={rowIn}>
					{#if r.art}<img class="art" src={r.art} alt="" />{/if}
					<div class="text">
						<p class="main">{r.text}</p>
						{#if r.sub}<p class="sub">{r.sub}</p>{/if}
					</div>
					{#if r.actions.length}
						<div class="acts">
							{#each r.actions as a (keyOf(a))}
								<button
									type="button"
									class:primary={a.op === 'done' || a.decision === 'allow' || a.kind === 'ack'}
									class:result={sent[keyOf(a)]}
									onclick={() => tap(a)}
								>{sent[keyOf(a)] || a.label}</button>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">{mirror.empty}</p>
	{/if}

	{#if mirror.controls.length}
		<div class="transport" role="group" aria-label="Playback">
			{#each mirror.controls as c (c.action)}
				<button type="button" class:main={c.action === 'play-pause'} aria-label={c.label} onclick={() => tap(c)}>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						{#if c.action === 'previous'}<path d="M6 6v12M18 6l-9 6 9 6V6Z" />
						{:else if c.action === 'next'}<path d="M18 6v12M6 6l9 6-9 6V6Z" />
						{:else if mirror.playing}<path d="M8 5v14M16 5v14" />
						{:else}<path d="M7 5l12 7-12 7V5Z" />{/if}
					</svg>
				</button>
			{/each}
		</div>
	{/if}
</section>

<style>
	.mirror {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.kicker {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-top: 1px solid var(--hairline);
	}
	li:first-child {
		border-top: 0;
	}
	li.calling .main::before {
		content: '';
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: var(--space-2);
		border-radius: 50%;
		background: var(--warn);
		vertical-align: 0.1em;
	}
	.art {
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-sm);
		object-fit: cover;
		flex: none;
	}
	.text {
		flex: 1;
		min-width: 0;
	}
	.main,
	.sub {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.main {
		font-weight: 600;
		color: var(--foreground);
	}
	.sub {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.empty {
		margin: 0;
		color: var(--text-tertiary);
	}
	.acts {
		display: flex;
		gap: var(--space-2);
		flex: none;
	}
	.acts button,
	.transport button {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 10%, transparent);
		color: var(--foreground);
		font: 600 var(--text-sm) var(--font-body);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			transform 120ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
			background-color 160ms ease,
			color 160ms ease;
	}
	.acts button.primary {
		background: var(--foreground);
		color: var(--background);
	}
	.acts button.result {
		background: color-mix(in srgb, var(--ok) 22%, transparent);
		color: var(--ok);
	}
	.acts button:active,
	.transport button:active {
		transform: scale(0.96);
		transition-duration: 0ms;
	}
	.transport {
		display: flex;
		justify-content: center;
		gap: var(--space-4);
	}
	.transport button {
		width: 3.25rem;
		padding: 0;
		display: grid;
		place-items: center;
	}
	.transport button.main {
		width: 4rem;
		min-height: 4rem;
		background: var(--foreground);
		color: var(--background);
	}
	.transport svg {
		width: 1.4rem;
		height: 1.4rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@media (max-width: 360px) {
		li {
			flex-wrap: wrap;
		}
	}
</style>
