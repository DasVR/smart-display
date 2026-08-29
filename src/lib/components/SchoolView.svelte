<script>
	import { onMount } from 'svelte';
	let mounted = false;
	let loading = true;
	let events = [];
	let error = null;

	onMount(() => {
		mounted = true;
		fetchEvents();
		const t = setInterval(fetchEvents, 300000); // 5 min
		return () => clearInterval(t);
	});

	async function fetchEvents() {
		try {
			const r = await fetch('/api/calendar?days=3');
			if (!r.ok) throw new Error('calendar failed');
			const d = await r.json();
			events = d.events || [];
			error = null;
		} catch (e) {
			error = 'calendar feed offline';
			events = [];
		} finally {
			loading = false;
		}
	}

	function urgency(event) {
		if (!event || !event.start) return false;
		const now = new Date();
		const start = new Date(event.start);
		const hours = (start - now) / 1000 / 60 / 60;
		return hours >= -2 && hours <= 24;
	}

	function dayLabel(iso) {
		const d = new Date(iso);
		const today = new Date();
		const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
		if (d.toDateString() === today.toDateString()) return 'Today';
		if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
		return d.toLocaleDateString('en-US', { weekday: 'short' });
	}

	function timeLabel(iso) {
		const d = new Date(iso);
		return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
	}
</script>

<div class="view-shell school-view" class:mounted>
	<div class="view-head">
		<h2 class="view-title">School</h2>
		<div class="view-meta">{events.length} upcoming</div>
	</div>

	{#if loading}
		<div class="list">
			{#each [1,2,3,4] as i}
				<div class="row skeleton" style="height:92px"></div>
			{/each}
		</div>
	{:else if error}
		<div class="empty-state">
			<div class="empty-title">{error}</div>
			<div>calendar not connected yet</div>
		</div>
	{:else if events.length === 0}
		<div class="empty-state">
			<div class="empty-title">no upcoming events</div>
			<div>add assignments to google calendar</div>
		</div>
	{:else}
		<div class="list">
			{#each events as e}
				<div class="row" class:urgent={urgency(e)}>
					<div class="row-left">
						<div class="row-title">{e.title}</div>
						{#if e.location}<div class="row-course">{e.location}</div>{/if}
					</div>
					<div class="row-right">
						<span class="due">{dayLabel(e.start)} {timeLabel(e.start)}</span>
						{#if urgency(e)}<span class="urgent-tag">soon</span>{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.school-view { gap: 32px; }

	.list {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.row {
		background: var(--surface);
		border: 1px solid var(--surface-border);
		border-radius: var(--r-md);
		padding: 38px 40px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
	}
	.row:hover {
		background: var(--surface-hover);
		border-color: var(--surface-border-strong);
	}
	.row.urgent {
		border-color: rgba(252,165,165,0.3);
		background: rgba(252,165,165,0.06);
	}
	.row-title { font-size: 40px; font-weight: 600; color: var(--text-primary); }
	.row-course { font-family: var(--font-display); font-size: 22px; color: var(--text-tertiary); margin-top: 10px; }
	.row-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
	.due {
		font-family: var(--font-display);
		font-size: 26px;
		color: var(--text-secondary);
	}
	.urgent-tag {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 8px 16px;
		border-radius: var(--r-sm);
		background: rgba(252,165,165,0.16);
		color: var(--warn);
		border: 1px solid rgba(252,165,165,0.3);
		box-shadow: 0 0 12px rgba(252,165,165,0.15);
	}
</style>
