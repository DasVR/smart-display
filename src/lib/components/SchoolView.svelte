<script>
	import { upcomingEvents } from '$lib/stores.js';
	import { onMount } from 'svelte';
	let mounted = false;
	onMount(() => { mounted = true; });

	const mockEvents = [
		{ title: 'Calc II HW #4', course: 'MAC 2312', due: 'Today 11:59PM', urgent: true },
		{ title: 'Read Ch. 7-8', course: 'ENC 1102', due: 'Tomorrow 8:00AM', urgent: false },
		{ title: 'Lab Report Draft', course: 'CHM 2045', due: 'Fri 5:00PM', urgent: false },
		{ title: 'Discussion Post', course: 'HUM 2020', due: 'Sun 11:59PM', urgent: false },
	];
</script>

<div class="school-view" class:mounted>
	<div class="header">
		<h2>School Brain</h2>
		<div class="meta">4 assignments this week</div>
	</div>
	<div class="events">
		{#each mockEvents as e, i}
			<div class="event-card" style="transition-delay: {i*60}ms">
				<div class="event-left">
					<div class="event-title">{e.title}</div>
					<div class="event-course">{e.course}</div>
				</div>
				<div class="event-right">
					<div class="due" class:urgent={e.urgent}>{e.due}</div>
					{#if e.urgent}<div class="badge">urgent</div>{/if}
				</div>
			</div>
		{/each}
	</div>
	<div class="placeholder">canvas + collegeboard apis coming soon</div>
</div>

<style>
	.school-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 80px 60px 40px;
		gap: 32px;
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.22,1,0.36,1);
	}
	.school-view.mounted { opacity: 1; transform: translateY(0); }

	.header { display: flex; justify-content: space-between; align-items: baseline; }
	.header h2 {
		font-size: clamp(28px, 3vw, 40px);
		font-weight: 600;
		letter-spacing: -0.02em;
		margin: 0;
		background: linear-gradient(90deg, #a9b1f0, #f5f2ec);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	.meta {
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		color: rgba(255,255,255,0.25);
		letter-spacing: 0.05em;
	}

	.events {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.event-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 16px;
		padding: 20px 24px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		transition: background 0.2s, border-color 0.2s, transform 0.3s, opacity 0.4s;
		transform: translateY(8px);
		opacity: 0;
	}
	.school-view.mounted .event-card {
		transform: translateY(0);
		opacity: 1;
	}
	.event-card:hover {
		background: rgba(255,255,255,0.06);
		border-color: rgba(255,255,255,0.12);
	}
	.event-title { font-size: 18px; font-weight: 500; color: #f5f2ec; }
	.event-course { font-size: 13px; color: rgba(255,255,255,0.3); margin-top: 4px; font-family: 'JetBrains Mono', monospace; }
	.due { font-size: 13px; color: rgba(255,255,255,0.35); font-family: 'JetBrains Mono', monospace; }
	.due.urgent { color: #fe6f69; }
	.badge {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba(254,111,105,0.12);
		color: #fe6f69;
		border: 1px solid rgba(254,111,105,0.2);
		margin-top: 6px;
	}

	.placeholder {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		color: rgba(255,255,255,0.1);
		text-align: center;
		margin-top: auto;
		letter-spacing: 0.08em;
	}
</style>
