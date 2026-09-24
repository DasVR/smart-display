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

	// The soonest thing still ahead: one line up top instead of a second
	// copy of the whole week (the timetable below already lists every item).
	let nextUp = $derived.by(() => {
		const now = Date.now();
		return (
			events
				.filter((e) => e.start && new Date(e.start).getTime() >= now - 36e5)
				.sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null
		);
	});
	let nextWhen = $derived(
		nextUp ? `${dayLabel(nextUp.start)}${nextUp.start.length > 10 ? ` · ${timeLabel(nextUp.start)}` : ''}` : ''
	);

	let timetableCaption = $derived.by(() => {
		if (loading) return '';
		if (error) return error;
		if (events.length === 0) return 'Nothing due';
		return '';
	});
</script>

<div class="school-hub">
	<header class="running">
		{#if loading}
			<p class="head-meta">Checking calendar</p>
		{:else if error}
			<p class="head-meta">{error}</p>
		{:else if nextUp}
			<p class="next" data-urgency={urgency(nextUp)}>
				<span class="next-k">Next up</span>
				<span class="next-title">{nextUp.title}</span>
				<span class="next-when num">{nextWhen}</span>
			</p>
			<p class="head-meta">{events.length} due in 7 days</p>
		{:else}
			<p class="head-meta">Clear this week</p>
		{/if}
	</header>

	<WeekTimetable {events} caption={timetableCaption} {loading} />
</div>

<style>
	.school-hub {
		height: 100%;
		width: 100%;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-6) var(--space-7);
		min-height: 0;
		min-width: 0;
	}
	.running {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-4);
		min-width: 0;
		flex-shrink: 0;
	}
	.head-meta {
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--text-lg);
		color: var(--text-tertiary);
		flex-shrink: 1;
		overflow-wrap: anywhere;
		min-width: 0;
		max-width: 100%;
	}
	.next {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		min-width: 0;
	}
	.next-k {
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.next-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		letter-spacing: -0.03em;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.next-when {
		font-size: var(--text-lg);
		color: var(--text-secondary);
	}
	.next[data-urgency='now'] .next-when {
		color: var(--warn);
	}
	.next[data-urgency='soon'] .next-when {
		color: var(--brand);
	}

	@media (max-width: 768px) {
		.running {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-2);
		}
	}
</style>
