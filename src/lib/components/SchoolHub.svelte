<script>
	import { onMount } from 'svelte';
	import { upcomingEvents } from '$lib/stores.js';

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
	<header class="hub-head">
		<div class="titles">
			<div class="eyebrow">School & Life</div>
			<h2 class="hub-title">Assignments</h2>
		</div>
		<div class="head-meta">{events.length} in the next 3 days</div>
	</header>

	{#if loading}
		<div class="archive" aria-busy="true">
			{#each [1, 2, 3] as i (i)}
				<div class="row skeleton"></div>
			{/each}
		</div>
	{:else if error}
		<div class="empty">
			<div class="empty-title">{error}</div>
			<div>Hermes calendar token not reachable</div>
		</div>
	{:else if events.length === 0}
		<div class="empty">
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
		gap: var(--space-4);
		padding: var(--space-5) var(--space-5) var(--space-4);
		min-height: 0;
		min-width: 0;
	}
	.hub-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: var(--space-4);
	}
	.titles {
		min-width: 0;
	}
	.eyebrow {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.hub-title {
		margin: var(--space-1) 0 0;
		font-size: clamp(1.8rem, 2.4vw, 2.6rem);
		font-weight: 600;
		font-style: normal;
		letter-spacing: -0.03em;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.head-meta {
		font-size: 14px;
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.archive {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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
		padding-top: var(--space-2);
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
		font-size: clamp(1.05rem, 1.4vw, 1.35rem);
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
		height: 56px;
		border-radius: var(--radius-sm);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: var(--space-2);
		color: var(--text-tertiary);
		font-size: 16px;
	}
	.empty-title {
		font-size: 28px;
		font-weight: 600;
		font-style: normal;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	@media (max-width: 768px) {
		.hub-head {
			flex-direction: column;
			align-items: flex-start;
		}
		.day {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-2);
		}
		.entry {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
