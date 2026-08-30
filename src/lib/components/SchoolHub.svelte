<script>
	import { onMount } from 'svelte';
	import { upcomingEvents } from '$lib/stores.js';
	import WeekTimetable from '$lib/components/WeekTimetable.svelte';

	let loading = $state(true);
	let error = $state(null);
	let events = $state([]);

	onMount(() => {
		fetchEvents();
		const t = setInterval(fetchEvents, 300000);
		return () => clearInterval(t);
	});

	async function fetchEvents() {
		try {
			const r = await fetch('/api/calendar?days=7');
			if (!r.ok) throw new Error('calendar failed');
			const d = await r.json();
			events = d.events || [];
			upcomingEvents.set(events);
			error = null;
		} catch {
			error = 'Calendar feed offline';
			events = [];
		} finally {
			loading = false;
		}
	}

	function urgency(event) {
		if (!event?.start) return 'later';
		const hours = (new Date(event.start) - new Date()) / 36e5;
		if (hours <= 6) return 'now';
		if (hours <= 24) return 'soon';
		return 'later';
	}

	function dayLabel(iso) {
		const d = new Date(iso);
		const today = new Date();
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		if (d.toDateString() === today.toDateString()) return 'Today';
		if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
		return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	}

	function timeLabel(iso) {
		const d = new Date(iso);
		if (iso?.length <= 10) return 'all day';
		return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
	}

	let groups = $derived.by(() => {
		const out = [];
		const seen = new Map();
		for (const event of events) {
			const key = event.start ? new Date(event.start).toDateString() : 'undated';
			if (!seen.has(key)) {
				const group = {
					key,
					label: event.start ? dayLabel(event.start) : 'Undated',
					items: []
				};
				seen.set(key, group);
				out.push(group);
			}
			seen.get(key).items.push(event);
		}
		return out;
	});

	let timetableCaption = $derived.by(() => {
		if (loading) return '';
		if (error) return error;
		if (events.length === 0) return 'No due work in the next 7 days';
		return '';
	});
</script>

<div class="school-hub">
	<header class="running">
		<h2 class="hub-title">┌ Assignments :: {events.length} ┐</h2>
		<p class="head-meta">
			{#if loading}
				Checking calendar
			{:else if error}
				{error}
			{:else}
				{events.length} upcoming
			{/if}
		</p>
	</header>

	{#if !loading && !error && events.length > 0}
		<div class="archive">
			{#each groups as group (group.key)}
				<section class="day">
					<h3 class="day-label">{group.label}</h3>
					<ol class="day-list">
						{#each group.items as e, i (e.id ?? `${group.key}-${i}`)}
							<li class="entry" data-urgency={urgency(e)}>
								<time class="when num">{timeLabel(e.start)}</time>
								<div class="body">
									<div class="row-title">{e.title}</div>
									<div class="row-sub">{e.location || 'Calendar'}</div>
								</div>
							</li>
						{/each}
					</ol>
				</section>
			{/each}
		</div>
	{/if}

	<WeekTimetable {events} caption={timetableCaption} {loading} />
</div>

<style>
	.school-hub {
		height: 100%;
		width: 100%;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		padding: var(--space-8);
		min-height: 0;
		min-width: 0;
	}
	.running {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		min-width: 0;
		flex-shrink: 0;
	}
	.hub-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		font-style: normal;
		letter-spacing: 0;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.head-meta {
		margin: 0;
		font-size: var(--text-lg);
		color: var(--text-tertiary);
		flex-shrink: 0;
	}
	.archive {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		overflow: auto;
		min-height: 0;
		flex: 0 1 auto;
		max-height: 48%;
	}
	.day {
		display: grid;
		grid-template-columns: minmax(0, 7.5rem) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.day-label {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 700;
		font-style: normal;
		color: var(--brand);
		padding-top: var(--space-1);
	}
	.day-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border);
	}
	.entry {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		gap: var(--space-2);
		align-items: baseline;
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border);
		min-height: 2.75rem;
	}
	.entry[data-urgency='now'] .when {
		color: var(--warn);
	}
	.entry[data-urgency='soon'] .when {
		color: var(--brand);
	}
	.when {
		font-size: var(--text-lg);
		color: var(--text-tertiary);
	}
	.row-title {
		font-family: var(--font-body);
		font-size: var(--text-xl);
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.row-sub {
		margin-top: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	@media (max-width: 768px) {
		.day {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-2);
		}
		.entry {
			grid-template-columns: minmax(0, 1fr);
		}
		.archive {
			max-height: none;
		}
	}
</style>
