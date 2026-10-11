<!--
	Something on the wall wants you (src/lib/attention.js): a timer that's
	done, a reminder, severe weather, a chore that's come due. One card, big
	enough to read and hit from across the room, until someone answers it.
	Agents asking for permission have their own card (ApprovalCard), so they
	aren't shown here. `compact` is the phone's version.
-->
<script>
	let { items = [], now = Date.now(), onack = null, ondone = null, onsnooze = null, compact = false } = $props();

	const KICKER = { timer: 'Timer', reminder: 'Reminder', severe: 'Severe weather', chore: 'Chore due', approval: 'Waiting on you' };

	let shown = $derived(items.filter((i) => i.kind !== 'approval'));
	let current = $derived(shown[0] ?? null);
	let more = $derived(Math.max(0, shown.length - 1));
	let ago = $derived(current ? Math.max(0, Math.floor((now - Date.parse(current.raisedAt)) / 1000)) : 0);
	let busy = $state('');

	$effect(() => {
		current?.id;
		busy = '';
	});

	function since(s) {
		if (s < 60) return 'just now';
		const m = Math.floor(s / 60);
		return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
	}
	function act(kind, fn) {
		if (!current || busy) return;
		busy = kind;
		fn?.(current);
	}
	let taskId = $derived(current?.ref?.startsWith('task:') ? current.ref.slice(5) : '');
</script>

{#if current}
	<div class="attention chrome-ring {current.kind} {current.level}" class:compact role="alertdialog" aria-modal="false" aria-labelledby="attention-title">
		<div class="top">
			<span class="who">
				<span class="dot" aria-hidden="true"></span>
				{KICKER[current.kind] || 'For you'}
			</span>
			<span class="ago num">{since(ago)}</span>
		</div>
		<p class="title" id="attention-title">{current.title.replace(/^timer:?\s*/i, '') || 'Timer'}{current.kind === 'timer' ? ' is done' : ''}</p>
		{#if current.body}<p class="body">{current.body}</p>{/if}
		<div class="actions" class:two={current.kind === 'chore' && taskId}>
			{#if current.kind === 'chore' && taskId}
				<button type="button" class="later" onclick={() => act('later', onsnooze)} disabled={!!busy}>{busy === 'later' ? 'Snoozing…' : 'Later'}</button>
				<button type="button" class="go" onclick={() => act('done', ondone)} disabled={!!busy}>{busy === 'done' ? 'Ticking off…' : 'Done'}</button>
			{:else}
				<button type="button" class="go" onclick={() => act('ack', onack)} disabled={!!busy}>{current.kind === 'timer' ? 'Stop' : 'Got it'}</button>
			{/if}
		</div>
		{#if more}<p class="more">{more} more waiting</p>{/if}
	</div>
{/if}

<style>
	.attention {
		--accent: var(--brand);
		width: min(40rem, calc(100vw - 2 * var(--space-5)));
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6, 1.5rem);
		border-radius: 1.75rem;
		background: color-mix(in srgb, var(--abyss-2) 92%, transparent);
		backdrop-filter: blur(24px) saturate(1.3);
		-webkit-backdrop-filter: blur(24px) saturate(1.3);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--foreground) 14%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent),
			0 30px 80px color-mix(in srgb, #000 65%, transparent);
		color: var(--foreground);
		animation: rise 320ms var(--spring-smooth) both;
		pointer-events: auto;
	}
	.timer,
	.reminder {
		--accent: var(--warn);
	}
	.severe {
		--accent: var(--danger);
	}
	.chore {
		--accent: var(--ok);
	}
	/* urgent ones breathe so they're seen from across the room */
	.urgent {
		animation:
			rise 320ms var(--spring-smooth) both,
			breathe 1.6s ease-in-out 320ms infinite;
	}
	@keyframes rise {
		from {
			transform: translateY(18px) scale(0.98);
			opacity: 0;
		}
	}
	@keyframes breathe {
		50% {
			box-shadow:
				inset 0 1px 0 color-mix(in srgb, var(--foreground) 14%, transparent),
				inset 0 0 0 2px var(--accent),
				0 0 60px color-mix(in srgb, var(--accent) 35%, transparent),
				0 30px 80px color-mix(in srgb, #000 65%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.attention,
		.urgent {
			animation: none;
		}
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--accent);
	}
	.dot {
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 0.3rem color-mix(in srgb, var(--accent) 22%, transparent);
	}
	.ago,
	.more {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.more {
		margin: 0;
	}
	.title {
		margin: 0;
		font-size: var(--text-3xl);
		font-weight: 700;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.body {
		margin: 0;
		font-size: var(--text-lg);
		line-height: 1.4;
		color: var(--text-secondary);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}
	.actions.two {
		grid-template-columns: 1fr 1fr;
	}
	.actions button {
		min-height: 4.25rem;
		border: 0;
		border-radius: 999px;
		font: inherit;
		font-size: var(--text-2xl);
		font-weight: 700;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 150ms var(--spring-smooth);
	}
	.actions button:active {
		transform: scale(0.97);
	}
	.actions button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.later {
		background: color-mix(in srgb, var(--foreground) 10%, transparent);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--foreground);
	}
	.go {
		background: var(--accent);
		color: var(--abyss);
	}

	/* phone */
	.compact {
		width: 100%;
		padding: var(--space-4);
		border-radius: 1.5rem;
		gap: var(--space-2);
	}
	.compact .who {
		font-size: var(--text-sm);
	}
	.compact .title {
		font-size: var(--text-xl);
	}
	.compact .body {
		font-size: var(--text-sm);
	}
	.compact .actions button {
		min-height: 3.25rem;
		font-size: var(--text-lg);
	}
</style>
