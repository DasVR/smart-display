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
			const r = await fetch('/api/calendar?days=3');
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

	function timeLabel(iso) {
		if (!iso) return '';
		if (iso.length <= 10) return 'all day';
		return new Date(iso)
			.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
			.toLowerCase();
	}

	let nextUp = $derived.by(() => {
		const now = Date.now();
		return (
			events.find((event) => {
				if (!event?.start) return false;
				if (event.start.length <= 10) return true;
				return new Date(event.start).getTime() >= now;
			}) ?? null
		);
	});

	let timetableCaption = $derived.by(() => {
		if (loading) return '';
		if (error) return error;
		if (events.length === 0) return 'No due work in the next 3 days';
		return '';
	});
</script>

<div class="school-hub">
	<header class="running">
		<div class="titles">
			<p class="kicker">Assignments</p>
			<h2 class="hub-title">Due work</h2>
		</div>
		<p class="head-meta">
			{#if loading}
				Checking calendar
			{:else if error}
				{error}
			{:else if nextUp}
				Next: {timeLabel(nextUp.start)}
				<span>{nextUp.title}</span>
			{:else}
				Next: open
			{/if}
		</p>
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
		gap: var(--space-3);
		padding: var(--space-2) var(--space-2) 0 0;
		min-height: 0;
		min-width: 0;
	}
	.running {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-3);
		min-width: 0;
		flex-shrink: 0;
	}
	.titles {
		min-width: 0;
	}
	.kicker {
		margin: 0 0 4px;
		font-family: var(--font-body);
		font-size: var(--type-floor);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.hub-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(28px, 2.4vw, 40px);
		font-weight: 400;
		font-style: normal;
		letter-spacing: -0.035em;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.head-meta {
		margin: 0;
		max-width: 28ch;
		font-size: 15px;
		color: var(--text-tertiary);
		text-align: right;
	}
	.head-meta span {
		display: block;
		color: var(--foreground);
		font-weight: 550;
		overflow-wrap: anywhere;
	}

	@media (max-width: 720px) {
		.head-meta {
			text-align: left;
		}
	}
</style>
