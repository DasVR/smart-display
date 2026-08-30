<script>
	import { onMount } from 'svelte';

	let { events = [], caption = '', loading = false } = $props();

	const DAY_START = 8;
	const DAY_END = 21;
	const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
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

	function isAllDay(event) {
		return !event?.start || event.start.length <= 10;
	}

	let weekDays = $derived.by(() => {
		const start = startOfWeek(now);
		return Array.from({ length: 7 }, (_, i) => {
			const date = new Date(start);
			date.setDate(start.getDate() + i);
			const dayEvents = events.filter((event) => event.start && sameDay(new Date(event.start), date));
			return {
				date,
				key: date.toISOString(),
				label: WEEKDAYS[i],
				num: date.getDate(),
				today: sameDay(date, now),
				count: dayEvents.length
			};
		});
	});

	let todayEvents = $derived(
		events.filter((event) => event.start && sameDay(new Date(event.start), now))
	);

	let allDayEvents = $derived(todayEvents.filter(isAllDay));
	let timedEvents = $derived(todayEvents.filter((event) => !isAllDay(event)));

	let nowPct = $derived.by(() => {
		const hours = now.getHours() + now.getMinutes() / 60;
		if (hours < DAY_START || hours > DAY_END) return null;
		return ((hours - DAY_START) / (DAY_END - DAY_START)) * 100;
	});

	let weekLabel = $derived(
		now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
	);

	function hourLabel(hour) {
		const suffix = hour >= 12 ? 'p' : 'a';
		const h = hour % 12 || 12;
		return `${h}${suffix}`;
	}

	function eventGeometry(event) {
		const start = new Date(event.start);
		const end = event.end ? new Date(event.end) : new Date(start.getTime() + 36e5);
		const startH = start.getHours() + start.getMinutes() / 60;
		const endH = Math.max(startH + 0.5, end.getHours() + end.getMinutes() / 60);
		const clampedStart = Math.min(Math.max(startH, DAY_START), DAY_END);
		const clampedEnd = Math.min(Math.max(endH, clampedStart + 0.5), DAY_END);
		const top = ((clampedStart - DAY_START) / (DAY_END - DAY_START)) * 100;
		const height = ((clampedEnd - clampedStart) / (DAY_END - DAY_START)) * 100;
		return `top: ${top}%; height: ${Math.max(height, 4)}%;`;
	}
</script>

<section class="timetable" aria-label="Week overview for {weekLabel}">
	<div class="week" role="list">
		{#each weekDays as day (day.key)}
			<div
				class="day"
				class:today={day.today}
				class:busy={day.count > 0}
				role="listitem"
				aria-current={day.today ? 'date' : undefined}
			>
				<span class="dow">{day.label}</span>
				<span class="dom num">{day.num}</span>
				<span class="dot" class:on={day.count > 0} aria-hidden="true"></span>
			</div>
		{/each}
	</div>

	<div class="allday">
		{#if loading}
			<span class="skeleton inline"></span>
		{:else if allDayEvents.length}
			{#each allDayEvents as event, i (event.id ?? `allday-${i}`)}
				<span class="allday-item">{event.title}</span>
			{/each}
		{:else if caption}
			<span class="caption">{caption}</span>
		{:else}
			<span class="caption">Today</span>
		{/if}
	</div>

	<div class="hours" aria-hidden={timedEvents.length === 0}>
		{#each HOURS as hour (hour)}
			<div class="hour-row">
				<span class="hour-label num">{hourLabel(hour)}</span>
				<span class="hour-rule"></span>
			</div>
		{/each}

		{#if nowPct !== null}
			<div class="now" style="top: {nowPct}%" title="Now">
				<span class="now-dot"></span>
			</div>
		{/if}

		{#each timedEvents as event, i (event.id ?? `timed-${i}`)}
			<article class="block" style={eventGeometry(event)}>
				<p class="block-title">{event.title}</p>
				{#if event.location}
					<p class="block-sub">{event.location}</p>
				{/if}
			</article>
		{/each}
	</div>
</section>

<style>
	.timetable {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-height: 0;
		min-width: 0;
		flex: 1;
		height: 100%;
	}
	.week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--space-2);
		flex-shrink: 0;
	}
	.day {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) 0;
		border-radius: var(--radius-sm);
		min-width: 0;
		color: var(--text-tertiary);
	}
	.day.today {
		background: var(--brand-soft);
		color: var(--foreground);
	}
	.dow {
		font-size: 12px;
		font-weight: 500;
		font-style: normal;
		line-height: 1;
	}
	.dom {
		font-size: 16px;
		font-weight: 600;
		font-style: normal;
		line-height: 1;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: transparent;
	}
	.dot.on {
		background: var(--brand);
	}
	.day.today .dot.on {
		background: var(--foreground);
	}
	.allday {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 32px;
		padding: 0 0 var(--space-2);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
		min-width: 0;
	}
	.caption,
	.allday-item {
		font-size: 14px;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.allday-item {
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--brand-soft);
		color: var(--foreground);
	}
	.inline {
		display: block;
		width: 160px;
		height: 16px;
	}
	.hours {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 160px;
		min-width: 0;
		overflow: hidden;
	}
	.hour-row {
		flex: 1;
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		gap: var(--space-2);
		align-items: start;
		min-height: 8px;
		min-width: 0;
	}
	.hour-label {
		font-size: 12px;
		line-height: 1;
		color: var(--text-tertiary);
		transform: translateY(-8px);
	}
	.hour-row:first-child .hour-label {
		transform: none;
	}
	.hour-rule {
		border-top: 1px solid var(--border);
		min-width: 0;
	}
	.now {
		position: absolute;
		left: 32px;
		right: 0;
		height: 2px;
		background: var(--brand);
		pointer-events: none;
		z-index: 2;
	}
	.now-dot {
		position: absolute;
		left: -4px;
		top: -3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--brand);
	}
	.block {
		position: absolute;
		left: 40px;
		right: 0;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--brand-soft);
		border-left: 2px solid var(--brand);
		overflow: hidden;
		z-index: 1;
		min-width: 0;
	}
	.block-title,
	.block-sub {
		margin: 0;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.block-title {
		font-size: 13px;
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
	}
	.block-sub {
		font-size: 12px;
		color: var(--text-secondary);
	}

	@media (max-width: 375px) {
		.hour-row {
			grid-template-columns: 24px minmax(0, 1fr);
		}
		.now,
		.block {
			left: 32px;
		}
		.dom {
			font-size: 14px;
		}
	}
</style>
