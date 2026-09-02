<script>
	import { onMount } from 'svelte';

	let { events = [], caption = '', loading = false } = $props();

	const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

	let now = $state(new Date());

	onMount(() => {
		const t = setInterval(() => {
			now = new Date();
		}, 30000);
		return () => clearInterval(t);
	});

	function startOfWeek(date) {
		const d = new Date(date);
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - d.getDay());
		return d;
	}

	function sameDay(a, b) {
		return a.toDateString() === b.toDateString();
	}

	function timeLabel(iso) {
		if (!iso || iso.length <= 10) return 'all day';
		return new Date(iso)
			.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
			.toLowerCase();
	}

	let weekDays = $derived.by(() => {
		const start = startOfWeek(now);
		return Array.from({ length: 7 }, (_, i) => {
			const date = new Date(start);
			date.setDate(start.getDate() + i);
			const items = events.filter((event) => event.start && sameDay(new Date(event.start), date));
			return {
				date,
				key: date.toISOString(),
				label: WEEKDAYS[i],
				num: date.getDate(),
				today: sameDay(date, now),
				items
			};
		});
	});

	let weekLabel = $derived(
		now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
	);

	let colTemplate = $derived(
		weekDays.map((day) => (day.today ? 'minmax(0, 1.85fr)' : 'minmax(0, 1fr)')).join(' ')
	);
</script>

<section class="timetable" aria-label="Week of {weekLabel}">
	<div class="board" style="--week-cols: {colTemplate}" role="list">
		{#each weekDays as day (day.key)}
			<article
				class="col"
				class:today={day.today}
				class:empty={day.today && day.items.length === 0 && !loading}
				role="listitem"
				aria-current={day.today ? 'date' : undefined}
			>
				<header class="col-head">
					<span class="dow">{day.label}</span>
					<span class="dom num">{day.num}</span>
					{#if day.items.length > 0}
						<span class="count num">{day.items.length}</span>
					{/if}
				</header>
				<div class="col-body">
					{#if loading && day.today}
						<span class="skeleton inline"></span>
						<span class="skeleton inline short"></span>
					{:else if day.items.length > 0}
						{#each day.items as event, i (event.id ?? `${day.key}-${i}`)}
							<div class="evt">
								<time class="when num">{timeLabel(event.start)}</time>
								<p class="title">{event.title}</p>
								{#if event.location}
									<p class="sub">{event.location}</p>
								{/if}
							</div>
						{/each}
					{:else if day.today && caption}
						<p class="caption">{caption}</p>
					{/if}
				</div>
			</article>
		{/each}
	</div>
</section>

<style>
	.timetable {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		flex: 1;
		height: 100%;
	}
	.board {
		flex: 1;
		display: grid;
		grid-template-columns: var(--week-cols, repeat(7, minmax(0, 1fr)));
		gap: var(--space-2);
		min-height: 10rem;
		min-width: 0;
		padding: var(--bezel-pad);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-bezel);
		background: var(--shell-fill);
		box-sizing: border-box;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		min-height: 0;
		padding: var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-bezel-inner);
		color: var(--text-tertiary);
		background: var(--abyss-1);
		box-shadow: var(--inset-spec);
	}
	.col:last-child {
		border-right: 1px solid var(--hairline);
	}
	.col.today {
		background: color-mix(in srgb, var(--abyss-2) 80%, var(--brand));
		color: var(--foreground);
	}
	.col-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-shrink: 0;
		min-width: 0;
	}
	.dow {
		font-size: var(--text-sm);
		font-weight: 500;
		font-style: normal;
		line-height: 1;
	}
	.dom {
		font-size: var(--text-2xl);
		font-weight: 600;
		font-style: normal;
		line-height: 1;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.count {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--brand);
	}
	.col.today .count {
		color: var(--foreground);
	}
	.col-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
		gap: var(--space-2);
		min-height: 0;
		min-width: 0;
		overflow: auto;
	}
	.col.empty .col-body {
		justify-content: center;
	}
	.caption {
		margin: 0;
		font-size: var(--text-lg);
		line-height: 1.4;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.col.today .caption {
		color: var(--text-secondary);
	}
	.evt {
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--hairline);
		min-width: 0;
	}
	.when {
		display: block;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.col.today .when {
		color: var(--brand);
	}
	.title,
	.sub {
		margin: 0;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.title {
		font-size: var(--text-lg);
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
	}
	.sub {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.inline {
		display: block;
		width: 100%;
		height: 16px;
	}
	.inline.short {
		width: 64%;
	}

	@media (max-width: 768px) {
		.dom {
			font-size: var(--text-xl);
		}
		.evt .sub {
			display: none;
		}
	}

	@media (max-width: 414px) {
		.board {
			grid-template-columns: repeat(7, minmax(0, 1fr));
			grid-template-rows: auto auto;
			min-height: 0;
		}
		.col {
			border: 1px solid var(--hairline);
			flex-direction: column;
			align-items: center;
			gap: var(--space-1);
			min-height: 0;
			padding: var(--space-2) var(--space-1);
		}
		.col:last-child {
			border-right: 1px solid var(--hairline);
		}
		.col:not(.today) .col-body {
			display: none;
		}
		.col.today {
			grid-column: 1 / -1;
			grid-row: 2;
			align-items: flex-start;
			min-height: 80px;
			padding: var(--space-4);
		}
		.col.today .col-head {
			display: none;
		}
		.col-head {
			width: auto;
			flex-direction: column;
			align-items: center;
			gap: var(--space-1);
		}
		.col-body {
			flex: 1;
		}
		.caption {
			margin: 0;
		}
	}
</style>
