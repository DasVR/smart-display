<script>
	import { onMount } from 'svelte';
	import { upcomingEvents } from '$lib/stores.js';
	let mounted = false;
	let loading = true;
	onMount(() => {
		mounted = true;
		// placeholder until canvas/collegeboard APIs land
		setTimeout(() => { loading = false; }, 700);
	});

	// PLACEHOLDER data - flagged, not fabricated as real
	const mockEvents = [
		{ title: 'Calculus II HW #4', course: 'MAC 2312', due: 'Today 11:59PM', urgent: true },
		{ title: 'Reading Ch. 7-8', course: 'ENC 1102', due: 'Tomorrow 8:00AM', urgent: false },
		{ title: 'Lab Report Draft', course: 'CHM 2045', due: 'Fri 5:00PM', urgent: false },
		{ title: 'Discussion Post', course: 'HUM 2020', due: 'Sun 11:59PM', urgent: false }
	];
</script>

<div class="view-shell school-view" class:mounted>
	<div class="view-head">
		<h2 class="view-title">School</h2>
		<div class="view-meta">4 this week</div>
	</div>

	{#if loading}
		<div class="list">
			{#each [1,2,3,4] as i}
				<div class="row skeleton" style="height:64px"></div>
			{/each}
		</div>
	{:else}
		<div class="list">
			{#each mockEvents as e}
				<div class="row">
					<div class="row-left">
						<div class="row-title">{e.title}</div>
						<div class="row-course">{e.course}</div>
					</div>
					<div class="row-right">
						<span class="due" class:urgent={e.urgent}>{e.due}</span>
						{#if e.urgent}<span class="urgent-tag">due</span>{/if}
					</div>
				</div>
			{/each}
		</div>
		<div class="api-note">canvas + collegeboard APIs coming</div>
	{/if}
</div>

<style>
	.school-view { gap: 20px; }

	.list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.row {
		background: var(--surface);
		border: 1px solid var(--surface-border);
		border-radius: var(--r-md);
		padding: 20px 24px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		transition: background 0.2s, border-color 0.2s;
	}
	.row:hover {
		background: var(--surface-hover);
		border-color: var(--surface-border-strong);
	}
	.row-title { font-size: 18px; font-weight: 500; color: var(--text-primary); }
	.row-course { font-family: var(--font-display); font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
	.row-right { text-align: right; }
	.due {
		font-family: var(--font-display);
		font-size: 13px;
		color: var(--text-secondary);
	}
	.due.urgent { color: var(--warn); }
	.urgent-tag {
		display: inline-block;
		margin-top: 6px;
		font-family: var(--font-display);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 3px 8px;
		border-radius: var(--r-sm);
		background: rgba(252,165,165,0.12);
		color: var(--warn);
		border: 1px solid rgba(252,165,165,0.2);
	}
	.api-note {
		font-family: var(--font-display);
		font-size: 11px;
		color: var(--text-tertiary);
		text-align: center;
		margin-top: auto;
		letter-spacing: 0.08em;
	}
</style>
