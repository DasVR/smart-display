<script>
	import { onMount } from 'svelte';

	let { events = [], caption = '', loading = false } = $props();

	const TZ = 'America/New_York';
	const OPEN_BANNER = `  ___  ___ ___ _  _
 / _ \\| _ \\ __| \\| |
| (_) |  _/ _|| .\` |
 \\___/|_| |___|_|\\_|`;

	let now = $state(new Date());

	onMount(() => {
		const t = setInterval(() => {
			now = new Date();
		}, 30000);
		return () => clearInterval(t);
	});

	function dateKey(date) {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: TZ,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(date);
	}

	function wallToday() {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: TZ,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric'
		}).formatToParts(now);
		const pick = (type) => Number(parts.find((p) => p.type === type)?.value);
		return new Date(pick('year'), pick('month') - 1, pick('day'));
	}

	function eventDayKey(iso) {
		if (!iso) return '';
		if (iso.length <= 10) return iso;
		return dateKey(new Date(iso));
	}

	function timeLabel(iso) {
		if (!iso || iso.length <= 10) return 'all day';
		return new Date(iso)
			.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
			.toLowerCase();
	}

	function dayStamp(date) {
		return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	}

	let columns = $derived.by(() => {
		const start = wallToday();
		return Array.from({ length: 3 }, (_, i) => {
			const date = new Date(start);
			date.setDate(start.getDate() + i);
			const key = dateKey(date);
			const items = events.filter((event) => eventDayKey(event.start) === key);
			const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-US', { weekday: 'long' });
			return {
				date,
				key,
				label,
				stamp: dayStamp(date),
				today: i === 0,
				items
			};
		});
	});
</script>

<section class="timetable" aria-label="Three-day schedule">
	<div class="board" role="list">
		{#each columns as day (day.key)}
			<article
				class="col"
				class:today={day.today}
				class:empty={day.items.length === 0 && !loading}
				role="listitem"
				aria-current={day.today ? 'date' : undefined}
			>
				<header class="col-head">
					<p class="label">{day.label}</p>
					<p class="stamp">{day.stamp}</p>
					{#if day.items.length > 0}
						<span class="count num">{day.items.length}</span>
					{/if}
				</header>
				<div class="col-body">
					{#if loading && day.today}
						<span class="skeleton inline"></span>
						<span class="skeleton inline short"></span>
					{:else if day.items.length > 0}
						{#each day.items as event, i (event.id ?? `${day.key}-${i}`)}
							<div class="evt">
								<time class="when num">{timeLabel(event.start)}</time>
								<p class="title">{event.title}</p>
								{#if event.location}
									<p class="sub">{event.location}</p>
								{/if}
							</div>
						{/each}
					{:else}
						<div class="ambient">
							<pre class="banner" aria-hidden="true">{OPEN_BANNER}</pre>
							<p class="open-word">Open</p>
							<p class="hint">{caption && day.today ? caption : 'Nothing due'}</p>
						</div>
					{/if}
				</div>
			</article>
		{/each}
	</div>
</section>

<style>
	.timetable {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		flex: 1;
		height: 100%;
	}
	.board {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-2);
		min-height: 0;
		min-width: 0;
		height: 100%;
		background: transparent;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		min-height: 0;
		height: 100%;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		background: transparent;
	}
	.col.today {
		border-color: color-mix(in srgb, var(--foreground) 22%, var(--border));
		color: var(--foreground);
	}
	.col-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px var(--space-2);
		flex-shrink: 0;
		min-width: 0;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border);
	}
	.label {
		margin: 0;
		grid-column: 1;
		font-family: var(--font-body);
		font-size: 16px;
		font-weight: 650;
		font-style: normal;
		color: var(--foreground);
		overflow-wrap: anywhere;
	}
	.stamp {
		margin: 0;
		grid-column: 1;
		font-family: var(--font-body);
		font-size: var(--type-floor);
		color: var(--text-tertiary);
	}
	.count {
		grid-column: 2;
		grid-row: 1 / span 2;
		align-self: center;
		font-size: var(--type-floor);
		color: var(--brand);
	}
	.col.today .count {
		color: var(--foreground);
	}
	.col-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
		gap: var(--space-2);
		min-height: 0;
		min-width: 0;
		overflow: auto;
	}
	.col.empty .col-body {
		justify-content: center;
	}
	.ambient {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 0;
		text-align: center;
	}
	.banner {
		margin: 0;
		max-width: 100%;
		overflow: hidden;
		font-family: var(--font-code);
		font-size: var(--type-floor);
		line-height: 1.1;
		color: var(--text-secondary);
		white-space: pre;
	}
	.open-word {
		margin: 0;
		font-family: var(--font-display);
		font-size: 28px;
		font-weight: 400;
		font-style: normal;
		letter-spacing: -0.03em;
		color: var(--foreground);
	}
	.hint {
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--type-floor);
		line-height: 1.4;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.evt {
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border);
		min-width: 0;
		min-height: 56px;
	}
	.when {
		display: block;
		font-size: 15px;
		color: var(--text-tertiary);
	}
	.col.today .when {
		color: var(--brand);
	}
	.title,
	.sub {
		margin: 0;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.title {
		font-size: 16px;
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
	}
	.sub {
		margin-top: 4px;
		font-size: var(--type-floor);
		color: var(--text-tertiary);
	}
	.inline {
		display: block;
		width: 100%;
		height: 16px;
	}
	.inline.short {
		width: 64%;
	}

	@media (max-width: 900px) {
		.board {
			grid-template-columns: 1fr;
		}
		.col {
			min-height: 180px;
		}
	}
</style>
