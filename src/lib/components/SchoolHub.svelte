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
		return d.toLocaleDateString('en-US', { weekday: 'short' });
	}

	function timeLabel(iso) {
		const d = new Date(iso);
		if (iso?.length <= 10) return 'all day';
		return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
	}
</script>

<div class="school-hub">
	<header class="hub-head">
		<div>
			<div class="eyebrow">School & Life</div>
			<h2 class="hub-title">Assignments</h2>
		</div>
		<div class="head-meta">{events.length} in the next 3 days</div>
	</header>

	{#if loading}
		<div class="list">
			{#each [1, 2, 3, 4] as i (i)}
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
		<div class="list">
			{#each events as e, i (e.id ?? i)}
				<div class="row">
					<div class="idx">{String(i + 1).padStart(2, '0')}</div>
					<div class="body">
						<div class="row-title">{e.title}</div>
						<div class="row-sub">{e.location || 'Calendar'}</div>
					</div>
					<div class="when">
						<span class="chip" data-urgency={urgency(e)}>{dayLabel(e.start)}</span>
						<span class="time">{timeLabel(e.start)}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.school-hub {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 22px 26px 18px;
		min-height: 0;
	}
	.hub-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 16px;
	}
	.eyebrow {
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: rgb(148, 163, 184);
	}
	.hub-title {
		margin: 4px 0 0;
		font-size: clamp(1.8rem, 2.4vw, 2.6rem);
		font-weight: 600;
		letter-spacing: -0.03em;
		color: #fff;
	}
	.head-meta {
		font-size: 14px;
		color: rgb(148, 163, 184);
		font-family: var(--font-display);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		overflow: hidden;
	}
	.row {
		display: grid;
		grid-template-columns: 48px 1fr auto;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		min-height: 72px;
	}
	.row.skeleton {
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.04));
		background-size: 200% 100%;
		animation: shimmer 1.6s infinite;
	}
	.idx {
		font-family: var(--font-display);
		font-size: 18px;
		color: rgb(100, 116, 139);
	}
	.row-title {
		font-size: clamp(1.15rem, 1.6vw, 1.55rem);
		font-weight: 600;
		color: #fff;
		letter-spacing: -0.02em;
	}
	.row-sub {
		margin-top: 2px;
		font-size: 13px;
		color: rgb(148, 163, 184);
		font-family: var(--font-display);
	}
	.when {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
	}
	.chip {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: rgb(203, 213, 225);
	}
	.chip[data-urgency='now'] {
		color: rgb(252, 165, 165);
		border-color: rgba(252, 165, 165, 0.4);
		background: rgba(252, 165, 165, 0.12);
	}
	.chip[data-urgency='soon'] {
		color: rgb(251, 191, 36);
		border-color: rgba(251, 191, 36, 0.35);
		background: rgba(251, 191, 36, 0.1);
	}
	.time {
		font-family: var(--font-display);
		font-size: 15px;
		color: rgb(148, 163, 184);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: rgb(100, 116, 139);
		font-size: 16px;
	}
	.empty-title {
		font-size: 28px;
		font-weight: 600;
		color: rgb(203, 213, 225);
	}
	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
