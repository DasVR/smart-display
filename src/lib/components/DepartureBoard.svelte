<!--
	The departure board (src/lib/departures.js): takes over the Clock view in
	the hour before a "Leave …" item. Left: where you're going and how long
	until you have to be out the door. Right: an airport-style board of what
	to bring, what to do first and what's due. Rows flip in once when they
	appear; nothing loops. Tapping a DO row ticks that chore off.
-->
<script>
	let { board, now = new Date(), ondone = null } = $props();

	const STATUS_TEXT = { bring: 'Bring', do: 'Do', due: 'Due' };
	const PHASE_TEXT = { ontime: 'On time', boarding: 'Boarding', final: 'Final call', go: 'Go now' };

	let nowText = $derived(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, ''));
</script>

<section class="departures" data-phase={board.phase} aria-label="Departure board: leave for {board.title} at {board.leaveText}">
	<div class="gate">
		<p class="kicker"><span class="dot" aria-hidden="true"></span>Departures</p>
		<p class="dest">{board.title}</p>
		{#if board.minutes > 0}
			<p class="count" aria-live="polite">
				<span class="lbl">Leave in</span>
				<span class="big">{board.minutes}</span>
				<span class="unit">min</span>
			</p>
		{:else}
			<p class="count go" aria-live="assertive"><span class="big">Go now</span></p>
		{/if}
		<p class="meta">
			<span class="chip">{PHASE_TEXT[board.phase]}</span>
			<span class="num">Departs {board.leaveText}</span>
			<span class="num faint">Now {nowText}</span>
		</p>
	</div>

	<div class="board" role="group" aria-label="Before you go">
		<div class="thead" aria-hidden="true">
			<span>Status</span>
			<span>Item</span>
			<span class="r">Note</span>
		</div>
		{#each board.rows as r, i (r.id)}
			{#if r.status === 'do' && r.taskId && ondone}
				<button type="button" class="row" data-status={r.status} style="--i: {i}" onclick={() => ondone(r.taskId)} aria-label="Mark {r.label} done">
					<span class="flap">{STATUS_TEXT[r.status]}</span>
					<span class="label">{r.label}</span>
					<span class="detail r num">{r.detail}</span>
				</button>
			{:else}
				<div class="row" data-status={r.status} style="--i: {i}">
					<span class="flap">{STATUS_TEXT[r.status]}</span>
					<span class="label">{r.label}</span>
					<span class="detail r num">{r.detail}</span>
				</div>
			{/if}
		{:else}
			<div class="row empty"><span class="label">Nothing to bring. Have a good one.</span></div>
		{/each}
		{#if board.more}<p class="more">+{board.more} more</p>{/if}
	</div>
</section>

<style>
	.departures {
		--board-amber: #f2b45a;
		width: 100%;
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		align-items: end;
		gap: var(--space-8);
		padding-bottom: var(--space-2);
		pointer-events: auto;
	}
	.departures[data-phase='final'],
	.departures[data-phase='go'] {
		--board-amber: var(--warn);
	}

	.kicker {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
		font-family: var(--font-code);
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--board-amber);
	}
	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 12px currentColor;
	}
	.dest {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(3rem, 5.4vw, 6rem);
		font-weight: 700;
		line-height: 0.95;
		letter-spacing: -0.035em;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin: var(--space-3) 0 var(--space-4);
		color: var(--foreground);
	}
	.lbl,
	.unit {
		font-size: var(--text-3xl);
		font-weight: 500;
		color: var(--text-secondary);
	}
	.big {
		font-family: var(--font-display);
		font-variant-numeric: tabular-nums;
		font-size: clamp(4.5rem, 9vw, 9.5rem);
		font-weight: 700;
		line-height: 0.85;
		letter-spacing: -0.05em;
	}
	.count.go .big {
		color: var(--warn);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
		margin: 0;
		font-size: var(--text-xl);
		color: var(--text-secondary);
	}
	.faint {
		color: var(--text-tertiary);
	}
	.chip {
		padding: 0.3rem 0.85rem;
		border-radius: 999px;
		font-family: var(--font-code);
		font-size: var(--text-base);
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--abyss);
		background: var(--board-amber);
	}
	.departures[data-phase='ontime'] .chip {
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 18%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ok) 45%, transparent);
	}

	/* the board */
	.board {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: var(--space-4);
		border-radius: var(--radius-lg, 1.25rem);
		background: color-mix(in srgb, #000 58%, transparent);
		box-shadow:
			inset 0 0 0 1px var(--hairline),
			inset 0 1px 0 color-mix(in srgb, var(--foreground) 8%, transparent);
	}
	.thead,
	.row {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-4);
	}
	.thead {
		padding: 0 var(--space-2) var(--space-2);
		font-family: var(--font-code);
		font-size: var(--text-sm);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.r {
		text-align: right;
	}
	.row {
		min-height: 3.6rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--foreground) 4%, transparent);
		color: inherit;
		font: inherit;
		text-align: left;
		transform-origin: 50% 0;
		animation: flap-in 420ms var(--spring-smooth, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
		animation-delay: calc(var(--i) * 70ms);
	}
	button.row {
		cursor: pointer;
		touch-action: manipulation;
	}
	button.row:active {
		transform: scale(0.99);
		background: color-mix(in srgb, var(--ok) 22%, transparent);
	}
	@keyframes flap-in {
		from {
			transform: perspective(600px) rotateX(-88deg);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.row {
			animation: none;
		}
	}
	/* split-flap tile: two halves with a hairline seam */
	.flap {
		position: relative;
		display: grid;
		place-items: center;
		height: 2.4rem;
		border-radius: 0.35rem;
		font-family: var(--font-code);
		font-size: var(--text-base);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--board-amber);
		background: linear-gradient(#17171d 0 49.5%, #0d0d12 50.5% 100%);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent);
	}
	.flap::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
		background: #000;
	}
	.row[data-status='do'] .flap {
		color: var(--warn);
	}
	.row[data-status='due'] .flap {
		color: var(--brand);
	}
	.label {
		font-size: var(--text-2xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detail {
		font-size: var(--text-lg);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.empty {
		grid-template-columns: 1fr;
	}
	.empty .label {
		font-size: var(--text-xl);
		color: var(--text-secondary);
	}
	.more {
		margin: var(--space-1) var(--space-2) 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	@media (max-width: 900px) {
		.departures {
			grid-template-columns: 1fr;
			gap: var(--space-5);
		}
		.thead,
		.row {
			grid-template-columns: 5rem minmax(0, 1fr);
		}
		.thead .r,
		.detail {
			display: none;
		}
		.label {
			font-size: var(--text-lg);
		}
	}
</style>
