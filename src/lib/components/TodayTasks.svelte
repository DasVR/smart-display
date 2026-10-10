<!--
	"Today" on the Clock view: chores and alerts that are overdue or due
	today, soonest first, plus a line for whatever is next. Tapping a row's
	circle marks it done (the kiosk can be touched; the phone remote and the
	API do the same thing). Renders nothing when there are no tasks at all,
	so an unused feature leaves the clock face clean.
-->
<script>
	import { eventDayKey, wallClock, wallDayKey } from '$lib/calendarItems.js';
	import { DISPLAY_TZ } from '$lib/atmosphere.js';

	let { tasks = [], ondone = null, now = new Date() } = $props();

	const LIST_MAX = 5;

	// Only what's waiting or due today on the wall's clock: a snooze that runs
	// into tomorrow belongs to tomorrow, not under "Today".
	let todayKey = $derived(wallDayKey(now.getTime()));
	let open = $derived(
		tasks.filter(
			(t) =>
				['overdue', 'due', 'today'].includes(t.status) ||
				(t.status === 'snoozed' && eventDayKey(t.snoozedUntil) === todayKey)
		)
	);
	let shown = $derived(open.slice(0, LIST_MAX));
	let more = $derived(Math.max(0, open.length - shown.length));
	let next = $derived(tasks.find((t) => t.status === 'upcoming') || null);
	let overdueCount = $derived(open.filter((t) => t.status === 'overdue' || t.status === 'due').length);

	function clock(iso) {
		return wallClock(Date.parse(iso)).toLowerCase();
	}
	function lateBy(iso) {
		const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
		if (mins < 60) return `${mins} min late`;
		const h = Math.round(mins / 60);
		return h < 24 ? `${h} h late` : `${Math.round(h / 24)} d late`;
	}
	function when(t) {
		if (t.allDay) return t.status === 'due' ? 'today' : t.kind === 'homework' ? 'due today' : 'today';
		if (t.status === 'overdue' || t.status === 'due') return lateBy(t.nextDue);
		if (t.status === 'snoozed') return `snoozed to ${clock(t.snoozedUntil)}`;
		return clock(t.nextDue);
	}
	function nextWhen(t) {
		const day = new Date(t.nextDue).toLocaleDateString('en-US', { weekday: 'short', timeZone: DISPLAY_TZ });
		return t.allDay ? day : `${day} ${clock(t.nextDue)}`;
	}
</script>

{#if tasks.length}
	<section class="today" aria-label="Today's chores and alerts">
		<header class="head">
			<span class="k">Today</span>
			{#if overdueCount}
				<span class="late">{overdueCount} waiting</span>
			{:else if !open.length}
				<span class="clear">All clear</span>
			{/if}
		</header>
		{#if shown.length}
			<ul>
				{#each shown as t (t.id)}
					<li class="row" data-status={t.status} data-kind={t.kind}>
						<button
							class="mark"
							type="button"
							aria-label={t.kind === 'alert' ? `Dismiss ${t.title}` : `Mark ${t.title} done`}
							onclick={() => ondone?.(t.id)}
							disabled={!ondone}
						>
							{#if t.kind === 'alert' || t.kind === 'reminder'}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
							{:else if t.kind === 'homework'}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5Z" /></svg>
							{/if}
						</button>
						<div class="body">
							<span class="title">{t.title}</span>
							{#if t.repeat}<span class="rule">{t.repeatText}</span>
							{:else if t.external}<span class="rule">{t.notes ? `${t.source} · ${t.notes}` : t.source}</span>{/if}
						</div>
						<span class="when num">{when(t)}</span>
					</li>
				{/each}
			</ul>
			{#if more}<p class="more">+{more} more</p>{/if}
		{/if}
		{#if next}
			<p class="next"><span class="k">Next</span> {next.title} <span class="num">{nextWhen(next)}</span></p>
		{/if}
	</section>
{/if}

<style>
	.today {
		width: min(100%, 27rem);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		pointer-events: auto;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--hairline);
	}
	.k {
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.late {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--warn);
	}
	.clear {
		font-size: var(--text-sm);
		color: var(--ok);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) 0;
	}
	.row + .row {
		border-top: 1px solid var(--hairline);
	}
	/* the circle is the done button: a hollow ring that fills on press */
	.mark {
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--foreground) 35%, transparent);
		background: transparent;
		color: var(--text-secondary);
		display: grid;
		place-items: center;
		cursor: pointer;
		touch-action: manipulation;
		transition-property: transform, background-color, border-color;
		transition-duration: 150ms;
	}
	.mark:active {
		transform: scale(0.96);
		background: color-mix(in srgb, var(--ok) 30%, transparent);
	}
	.mark:disabled {
		cursor: default;
	}
	.mark svg {
		width: 0.95rem;
		height: 0.95rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.row[data-kind='alert'] .mark,
	.row[data-kind='reminder'] .mark,
	.row[data-kind='homework'] .mark {
		border-color: transparent;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
	}
	.row[data-status='overdue'] .mark,
	.row[data-status='due'] .mark {
		border-color: var(--warn);
		color: var(--warn);
	}
	.body {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.title {
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row[data-status='snoozed'] .title {
		color: var(--text-secondary);
	}
	.rule {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.when {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.row[data-status='overdue'] .when,
	.row[data-status='due'] .when {
		color: var(--warn);
	}
	.more,
	.next {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.next .num {
		margin-left: var(--space-2);
		color: var(--text-secondary);
	}
	.next .k {
		margin-right: var(--space-2);
	}
</style>
