<script>
	let { time = new Date() } = $props();

	let colonOn = $derived(time.getSeconds() % 2 === 0);
	let dispH = $derived(time.getHours() % 12 || 12);
	let mm = $derived(String(time.getMinutes()).padStart(2, '0'));
	let ss = $derived(String(time.getSeconds()).padStart(2, '0'));
	let ampm = $derived(time.getHours() >= 12 ? 'PM' : 'AM');
	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long' }));
	let day = $derived(time.getDate());
</script>

<div class="hero-clock">
	<div class="time">
		<span class="num hour">{dispH}</span>
		<span class="colon" class:on={colonOn}>:</span>
		<span class="num">{mm}</span>
		<span class="seconds num">{ss}</span>
		<span class="ampm">{ampm}</span>
	</div>
	<div class="date">{weekday}, {month} {day}</div>
</div>

<style>
	.hero-clock {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.time {
		display: flex;
		align-items: baseline;
		font-weight: 300;
		font-size: clamp(3.2rem, 6vw, 6.2rem);
		letter-spacing: -0.05em;
		line-height: 0.95;
		color: var(--foreground);
		font-style: normal;
		min-width: 0;
	}
	.hour,
	.time {
		overflow-wrap: anywhere;
	}
	.colon {
		opacity: 0.28;
		transition: opacity 0.25s var(--ease-standard);
		margin: 0 2px;
		font-style: normal;
	}
	.colon.on {
		opacity: 1;
		color: var(--brand);
	}
	.seconds {
		margin-left: 10px;
		font-size: 0.38em;
		font-weight: 400;
		letter-spacing: 0.02em;
		color: var(--text-tertiary);
	}
	.ampm {
		margin-left: 8px;
		font-size: 0.22em;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.date {
		font-size: clamp(1rem, 1.4vw, 1.35rem);
		color: var(--text-secondary);
		font-weight: 500;
		overflow-wrap: anywhere;
		min-width: 0;
	}
</style>
