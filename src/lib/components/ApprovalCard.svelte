<!--
	"Claude Code needs you": an agent stopped to ask before running a tool,
	and the wall can answer (src/lib/approvals.js). One card at a time, big
	enough to read and hit from a step away, with a ring that drains toward
	the deadline. After that the agent asks in its own terminal instead.
-->
<script>
	let { approvals = [], now = Date.now(), ondecide = null, compact = false } = $props();

	let current = $derived(approvals[0] ?? null);
	let more = $derived(Math.max(0, approvals.length - 1));
	let total = $derived(current ? Date.parse(current.expiresAt) - Date.parse(current.createdAt) : 1);
	let left = $derived(current ? Math.max(0, Date.parse(current.expiresAt) - now) : 0);
	let secs = $derived(Math.ceil(left / 1000));
	let pending = $state('');

	$effect(() => {
		// a new card clears the "sending" state from the last one
		current?.id;
		pending = '';
	});

	function decide(decision) {
		if (!current || pending) return;
		pending = decision;
		ondecide?.(current.id, decision);
	}
	function countdown(s) {
		return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
	}
</script>

{#if current}
	<div class="approval" class:compact role="alertdialog" aria-modal="false" aria-labelledby="approval-title" aria-describedby="approval-detail">
		<div class="top">
			<span class="who">
				<span class="ring" style="--p: {left / total}" aria-hidden="true"></span>
				{current.source} needs you
			</span>
			<span class="left num" aria-label="{secs} seconds left">{countdown(secs)}</span>
		</div>
		<p class="title" id="approval-title">{current.title}</p>
		{#if current.detail}
			<pre class="detail" id="approval-detail">{current.detail}</pre>
		{/if}
		{#if current.cwd}<p class="where">in {current.cwd}</p>{/if}
		<div class="actions">
			<button type="button" class="deny" onclick={() => decide('deny')} disabled={!!pending}>
				{pending === 'deny' ? 'Denying…' : 'Deny'}
			</button>
			<button type="button" class="allow" onclick={() => decide('allow')} disabled={!!pending}>
				{pending === 'allow' ? 'Allowing…' : 'Allow'}
			</button>
		</div>
		{#if more}<p class="more">{more} more waiting</p>{/if}
	</div>
{/if}

<style>
	.approval {
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
			inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent),
			0 30px 80px color-mix(in srgb, #000 65%, transparent);
		color: var(--foreground);
		animation: rise 320ms var(--spring-smooth) both;
		pointer-events: auto;
	}
	@keyframes rise {
		from {
			transform: translateY(18px) scale(0.98);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.approval {
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
		color: var(--warn);
	}
	/* drains toward the deadline */
	.ring {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		background: conic-gradient(var(--warn) calc(var(--p) * 360deg), color-mix(in srgb, var(--warn) 18%, transparent) 0);
		mask: radial-gradient(circle, transparent 46%, #000 48%);
		-webkit-mask: radial-gradient(circle, transparent 46%, #000 48%);
	}
	.left {
		font-size: var(--text-lg);
		color: var(--text-tertiary);
	}
	.title {
		margin: 0;
		font-size: var(--text-3xl);
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.detail {
		margin: 0;
		max-height: 9.5rem;
		overflow: hidden;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, #000 45%, transparent);
		font-family: var(--font-code);
		font-size: var(--text-lg);
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--text-secondary);
		mask-image: linear-gradient(#000 75%, transparent);
		-webkit-mask-image: linear-gradient(#000 75%, transparent);
	}
	.where,
	.more {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		margin-top: var(--space-2);
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
	.deny {
		background: color-mix(in srgb, var(--foreground) 10%, transparent);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--foreground);
	}
	.allow {
		background: var(--ok);
		color: var(--abyss);
	}

	/* phone */
	.compact {
		width: 100%;
		padding: var(--space-4);
		border-radius: 1.5rem;
		gap: var(--space-2);
	}
	.compact .who,
	.compact .left {
		font-size: var(--text-sm);
	}
	.compact .title {
		font-size: var(--text-xl);
	}
	.compact .detail {
		font-size: 0.8rem;
		max-height: 6rem;
		padding: var(--space-2) var(--space-3);
	}
	.compact .actions button {
		min-height: 3.25rem;
		font-size: var(--text-lg);
	}
</style>
