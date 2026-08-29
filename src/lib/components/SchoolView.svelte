<script>
	import { onMount } from 'svelte';
	let mounted = false;
	let loading = true;
	let events = [];
	let error = null;

	onMount(() => {
		mounted = true;
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

<div class="school-view" class:mounted>
	<div class="header">
		<div class="big-label">SCHOOL</div>
		<div class="sub">{events.length} upcoming in next 3 days</div>
	</div>

	{#if loading}
		<div class="list">
			{#each [1,2,3,4] as i}
				<div class="row skeleton" style="height:110px"></div>
			{/each}
		</div>
	{:else if error}
		<div class="empty">
			<div class="empty-title">{error}</div>
			<div>calendar not connected yet</div>
		</div>
	{:else if events.length === 0}
		<div class="empty">
			<div class="empty-title">no upcoming events</div>
			<div>add assignments to google calendar</div>
		</div>
	{:else}
		<div class="list">
			{#each events as e, i}
				<div class="row" class:urgent={urgency(e)}>
					<div class="row-left">
						<span class="idx">{i + 1}</span>
						<div class="row-body">
							<div class="row-title">{e.title}</div>
							{#if e.location}<div class="row-course">{e.location}</div>{/if}
						</div>
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
	.school-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 110px 80px 60px;
		gap: 40px;
		opacity: 0;
		transform: translateY(14px);
		transition: opacity 0.5s var(--ease-standard), transform 0.6s var(--ease-standard);
	}
	.school-view.mounted { opacity: 1; transform: translateY(0); }

	.header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		padding-bottom: 28px;
	}
	.big-label {
		font-family: var(--font-display);
		font-size: clamp(42px, 5vw, 72px);
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}
	.sub { font-size: clamp(18px, 1.6vw, 26px); color: var(--text-secondary); }

	.list {
		display: flex;
		flex-direction: column;
		gap: 18px;
		flex: 1;
	}
	.row {
		background: var(--surface);
		border: 1px solid var(--surface-border);
		border-radius: var(--r-lg);
		padding: 34px 40px;
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
		box-shadow: 0 0 24px rgba(252,165,165,0.1);
	}
	.row-left { display: flex; align-items: center; gap: 24px; }
	.idx {
		font-family: var(--font-display);
		font-size: 20px;
		color: var(--text-tertiary);
		width: 34px;
	}
	.row-title { font-size: clamp(30px, 2.8vw, 46px); font-weight: 600; color: var(--text-primary); }
	.row-course { font-family: var(--font-display); font-size: 18px; color: var(--text-tertiary); margin-top: 6px; }
	.row-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
	.due {
		font-family: var(--font-display);
		font-size: clamp(20px, 1.8vw, 30px);
		color: var(--text-secondary);
	}
	.urgent-tag {
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 7px 16px;
		border-radius: var(--r-sm);
		background: rgba(252,165,165,0.16);
		color: var(--warn);
		border: 1px solid rgba(252,165,165,0.3);
		box-shadow: 0 0 14px rgba(252,165,165,0.15);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: var(--text-tertiary);
		font-size: 24px;
	}
	.empty-title { font-size: 34px; color: var(--text-secondary); font-weight: 600; }
</style>
