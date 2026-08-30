<script>
	import { onMount } from 'svelte';
	import { upcomingEvents } from '$lib/stores.js';
	import DotMatrix from '$lib/components/DotMatrix.svelte';

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
			error = 'calendar feed offline';
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
</script>

<div class="school-hub">
	<header class="running">
		<h2 class="hub-title">┌ Assignments :: {events.length} ┐</h2>
		<p class="head-meta">{events.length} in the next 3 days</p>
	</header>

	{#if loading}
		<div class="archive" aria-busy="true">
			{#each [1, 2, 3] as i (i)}
				<div class="row skeleton"></div>
			{/each}
		</div>
	{:else if error}
		<div class="empty">
			<DotMatrix opacity={0.22} />
			<div class="empty-title">{error}</div>
			<div>Hermes calendar token not reachable</div>
		</div>
	{:else if events.length === 0}
		<div class="empty">
			<DotMatrix opacity={0.22} />
			<div class="empty-title">Clear next 3 days</div>
			<div>Canvas and Calendar will land here</div>
		</div>
	{:else}
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
</div>

<style>
	.school-hub {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-2) var(--space-2) 0 0;
		min-height: 0;
		min-width: 0;
	}
	.running {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.hub-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.05rem, 1.5vw, 1.3rem);
		font-weight: 500;
		font-style: normal;
		letter-spacing: 0;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.head-meta {
		margin: 0;
		font-size: 14px;
		color: var(--text-tertiary);
	}
	.archive {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		overflow: auto;
		min-height: 0;
	}
	.day {
		display: grid;
		grid-template-columns: minmax(0, 7.5rem) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.day-label {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
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
		gap: var(--space-3);
		align-items: baseline;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--border);
	}
	.entry[data-urgency='now'] .when {
		color: var(--warn);
	}
	.entry[data-urgency='soon'] .when {
		color: var(--brand);
	}
	.when {
		font-size: 14px;
		color: var(--text-tertiary);
	}
	.row-title {
		font-family: var(--font-body);
		font-size: clamp(1.15rem, 1.7vw, 1.55rem);
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.row-sub {
		margin-top: 2px;
		font-size: 13px;
		color: var(--text-tertiary);
	}
	.row.skeleton {
		height: 48px;
		border-radius: var(--radius-sm);
	}
	.empty {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-start;
		padding-top: var(--space-4);
		gap: var(--space-2);
		color: var(--text-tertiary);
		font-size: 16px;
	}
	.empty > :not(:first-child) {
		position: relative;
		z-index: 1;
	}
	.empty-title {
		position: relative;
		z-index: 1;
		font-family: var(--font-body);
		font-size: clamp(1.6rem, 2.2vw, 2.1rem);
		font-weight: 600;
		font-style: normal;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	@media (max-width: 768px) {
		.day {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-2);
		}
		.entry {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
