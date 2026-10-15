<!--
	The agents on the wall's bottom edge (src/lib/agentStage.js): each working
	agent sits on top of the bar typing at its laptop; one with a question
	shuts the laptop, stands and waves, and a speech bubble beside it asks.
	Answer from the bubble, the phone or the Action button, and the character
	hops (yes) or slumps (no), then goes back to work or climbs down.

	Characters climb in and out from behind the bar a pixel at a time
	(steps()), never sliding. The bubble replaces the wall's old Allow / Deny
	card; the phone keeps its own card.
-->
<script>
	import { untrack } from 'svelte';
	import AgentCharacter from './AgentCharacter.svelte';
	import { CHARACTERS } from '$lib/agentSprites.js';
	import { castFor, countdown, speakerOf } from '$lib/agentStage.js';

	let { roster = [], approvals = [], now = Date.now(), ondecide = null, guest = false, paused = false, onpresence = null } = $props();

	/** CSS pixels per sprite; 22 art pixels wide, so 12 device pixels each at 1x: readable across the room. */
	const SIZE = 264;
	const ART = SIZE / 22;

	let cast = $derived(castFor({ roster, approvals }));
	let speaker = $derived(speakerOf(cast));

	// who's on stage, including those climbing down: { character, entry, state: 'in'|'on'|'out', verdict, verdictKey }
	let shown = $state([]);
	let verdicts = $state({}); // character -> { verdict, key, at }
	let pending = $state(''); // the approval being answered from the bubble
	let keySeq = 0;

	$effect(() => {
		const live = new Map(cast.map((c) => [c.character, c]));
		const t = Date.now();
		const prev = untrack(() => shown);
		const vs = untrack(() => verdicts);
		let next = prev.map((s) => {
			const entry = live.get(s.character);
			if (entry) return { ...s, entry, state: s.state === 'out' ? 'on' : s.state, leaveAt: 0 };
			if (s.state === 'out') return s;
			// gone: let a hop or slump finish before climbing down
			const v = vs[s.character];
			const wait = v && t - v.at < 2400 ? 2400 - (t - v.at) : 700;
			return { ...s, leaveAt: s.leaveAt || t + wait };
		});
		for (const [character, entry] of live) {
			if (!next.some((s) => s.character === character)) next.push({ character, entry, state: 'in', leaveAt: 0 });
		}
		const order = Object.keys(CHARACTERS);
		next.sort((a, b) => order.indexOf(a.character) - order.indexOf(b.character));
		shown = next;
	});

	// arrivals climb up on the next frame; leavers climb down when it's time, then go
	$effect(() => {
		if (!shown.some((s) => s.state === 'in' || s.leaveAt)) return;
		const timer = setInterval(() => {
			const t = Date.now();
			let changed = false;
			const next = [];
			for (const s of shown) {
				if (s.state === 'in') {
					next.push({ ...s, state: 'on' });
					changed = true;
				} else if (s.leaveAt && s.state !== 'out' && t >= s.leaveAt) {
					next.push({ ...s, state: 'out', goneAt: t + 450 });
					changed = true;
				} else if (s.state === 'out' && t >= s.goneAt) changed = true;
				else next.push(s);
			}
			if (changed) shown = next;
		}, 120);
		return () => clearInterval(timer);
	});

	// the wall makes room above the bar while anyone is on stage
	$effect(() => onpresence?.(shown.length > 0));

	function targetFor(s) {
		if (s.state === 'out' || !s.entry) return 'idle';
		return s.entry.target;
	}

	function decide(decision) {
		const a = speaker?.approval;
		if (!a || pending) return;
		pending = a.id;
		verdicts = { ...verdicts, [speaker.character]: { verdict: decision === 'allow' ? 'yes' : 'no', key: ++keySeq, at: Date.now() } };
		ondecide?.(a.id, decision);
	}
	$effect(() => {
		// the answered approval has gone: the bubble is free for the next one
		if (pending && !approvals.some((a) => a.id === pending)) pending = '';
	});

	let total = $derived(speaker ? Date.parse(speaker.approval.expiresAt) - Date.parse(speaker.approval.createdAt) : 1);
	let left = $derived(speaker ? Math.max(0, Date.parse(speaker.approval.expiresAt) - now) : 0);
	let speakerIndex = $derived(speaker ? shown.findIndex((s) => s.character === speaker.character) : -1);
	let more = $derived(cast.reduce((n, c) => n + (c.approval ? 1 : 0) + c.waiting, 0) - 1);
</script>

{#if shown.length}
	<div class="agent-stage" style:--slot="{SIZE}px" style:--art="{ART}px">
		<div class="ledge">
			{#each shown as s (s.character)}
				<div class="slot" class:up={s.state === 'on'} class:down={s.state === 'out'}>
					<AgentCharacter
						character={s.character}
						target={targetFor(s)}
						verdict={verdicts[s.character]?.verdict ?? null}
						verdictKey={verdicts[s.character]?.key ?? 0}
						size={SIZE}
						{paused}
						label={`${s.entry?.name || CHARACTERS[s.character].label}: ${s.entry?.target === 'ask' ? 'needs you' : 'working'}`}
					/>
				</div>
			{/each}
		</div>

		{#if speaker && speakerIndex >= 0}
			{@const a = speaker.approval}
			<div
				class="bubble"
				style:--at={speakerIndex + 1}
				style:--accent={CHARACTERS[speaker.character].accent}
				role="alertdialog"
				aria-modal="false"
				aria-labelledby="agent-q"
				aria-describedby="agent-detail"
			>
				<div class="top">
					<span class="who"><span class="ring" style:--p={left / total} aria-hidden="true"></span>{speaker.name} needs you</span>
					<span class="left num" aria-label="{Math.ceil(left / 1000)} seconds left">{countdown(a.expiresAt, now)}</span>
				</div>
				<p class="q" id="agent-q">{a.title}</p>
				{#if guest}
					<p class="where" id="agent-detail">Details are hidden in Guest mode. Answer from your phone to see them.</p>
				{:else}
					{#if a.detail}<pre class="detail" id="agent-detail">{a.detail}</pre>{/if}
					{#if a.cwd}<p class="where">in {a.cwd}</p>{/if}
				{/if}
				<div class="acts">
					<button type="button" class="deny" onclick={() => decide('deny')} disabled={!!pending}>{pending ? '…' : 'Deny'}</button>
					<button type="button" class="allow" onclick={() => decide('allow')} disabled={!!pending}>{pending ? '…' : 'Allow'}</button>
				</div>
				{#if more > 0}<p class="where">{more} more waiting</p>{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.agent-stage {
		position: absolute;
		left: var(--space-6, 1.5rem);
		right: var(--space-6, 1.5rem);
		bottom: 100%;
		height: calc(var(--art) * 12);
		pointer-events: none;
		z-index: 5;
	}
	/* the bar's top edge: characters are clipped below it, so they climb up from behind it */
	.ledge {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		clip-path: inset(-40rem -40rem 0 -40rem);
	}
	.slot {
		flex: none;
		width: var(--slot);
		/* the sprite's feet are two art pixels above its canvas's bottom edge */
		margin-bottom: calc(var(--art) * -2);
		transform: translateY(100%);
	}
	.slot.up {
		transform: translateY(0);
		transition: transform 560ms steps(8, end);
	}
	.slot.down {
		transform: translateY(100%);
		transition: transform 320ms steps(4, end);
	}
	@media (prefers-reduced-motion: reduce) {
		.slot.up,
		.slot.down {
			transition: none;
		}
	}

	/* a speech bubble with a stepped pixel border, beside whoever is asking */
	.bubble {
		position: absolute;
		left: calc(var(--slot) * var(--at) + var(--space-3, 0.75rem));
		bottom: calc(var(--art) * 3);
		width: min(34rem, calc(100vw - var(--slot) * var(--at) - 6rem));
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 0.75rem);
		padding: var(--space-5, 1.25rem) var(--space-6, 1.5rem);
		background: var(--abyss-2);
		color: var(--foreground);
		box-shadow:
			0 calc(var(--art) * -0.5) 0 0 var(--text-tertiary),
			0 calc(var(--art) * 0.5) 0 0 var(--text-tertiary),
			calc(var(--art) * -0.5) 0 0 0 var(--text-tertiary),
			calc(var(--art) * 0.5) 0 0 0 var(--text-tertiary),
			0 30px 80px color-mix(in srgb, #000 65%, transparent);
		pointer-events: auto;
	}
	.bubble::before {
		content: '';
		position: absolute;
		left: calc(var(--art) * -2.5);
		bottom: calc(var(--art) * 2);
		width: calc(var(--art) * 2);
		height: var(--art);
		background: var(--text-tertiary);
		box-shadow: var(--art) calc(var(--art) * -0.5) 0 0 var(--text-tertiary);
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3, 0.75rem);
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2, 0.5rem);
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.ring {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: conic-gradient(var(--accent) calc(var(--p) * 360deg), color-mix(in srgb, var(--accent) 18%, transparent) 0);
		mask: radial-gradient(circle, transparent 46%, #000 48%);
		-webkit-mask: radial-gradient(circle, transparent 46%, #000 48%);
	}
	.left {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.q {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.15;
		overflow-wrap: anywhere;
	}
	.detail {
		margin: 0;
		max-height: 7rem;
		overflow: hidden;
		padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
		background: color-mix(in srgb, #000 45%, transparent);
		font-family: var(--font-code);
		font-size: var(--text-base);
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--text-secondary);
	}
	.where {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.acts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3, 0.75rem);
	}
	.acts button {
		min-height: 3.25rem;
		border: 0;
		font: 700 var(--text-lg) var(--font-body);
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 120ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.acts button:active {
		transform: scale(0.97);
		transition-duration: 0ms;
	}
	.deny {
		background: color-mix(in srgb, var(--foreground) 12%, transparent);
		color: var(--foreground);
	}
	.allow {
		background: var(--accent);
		color: #000;
	}
	.acts button:disabled {
		opacity: 0.6;
	}
</style>
