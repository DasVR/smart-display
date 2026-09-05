<script>
	let { time = new Date(), size = 'masthead' } = $props();

	function estParts(d) {
		const s = new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
		const [, timePart] = s.split(', ');
		const [h, m, sPart] = timePart.split(':');
		const sec = sPart.split(' ')[0];
		return { h: parseInt(h, 10), m: parseInt(m, 10), sec: parseInt(sec, 10) };
	}

	let est = $derived(estParts(time));
	let colonOn = $derived(est.sec % 2 === 0);
	let dispH = $derived(est.h % 12 || 12);
	let mm = $derived(String(est.m).padStart(2, '0'));
	let ss = $derived(String(est.sec).padStart(2, '0'));
	let ampm = $derived(est.h >= 12 ? 'PM' : 'AM');
</script>

<div class="hero-clock" data-size={size}>
	<div class="time">
		<span class="hour">{dispH}</span>
		<span class="colon" class:on={colonOn}>:</span>
		<span class="minute">{mm}</span>
		<span class="seconds">{ss}</span>
		<span class="ampm">{ampm}</span>
	</div>
</div>

<style>
	.hero-clock {
		min-width: 0;
		font-family: var(--font-display);
	}
	.time {
		display: flex;
		align-items: baseline;
		font-weight: 500;
		font-size: clamp(2.75rem, 6vw, 5rem);
		letter-spacing: -0.06em;
		line-height: 0.88;
		color: var(--foreground);
		font-family: var(--font-display);
		font-style: normal;
		font-variant-numeric: tabular-nums;
		min-width: 0;
		white-space: nowrap;
	}
	.hero-clock[data-size='poster'] .time {
		font-size: clamp(5.5rem, 18vw, 12.75rem);
		letter-spacing: -0.07em;
		line-height: 0.82;
		font-weight: 500;
	}
	.colon {
		opacity: 0.28;
		transform: scale(1);
		transform-origin: center 58%;
		margin: 0 0.08em;
		font-style: normal;
		color: var(--text-secondary);
		transition:
			opacity 420ms var(--spring-smooth),
			transform 420ms var(--spring-snappy),
			color 420ms var(--spring-smooth);
	}
	.colon.on {
		opacity: 1;
		transform: scale(1.04);
		color: var(--brand);
	}
	.seconds {
		margin-left: var(--space-2);
		font-size: 0.28em;
		font-weight: 500;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
		letter-spacing: normal;
	}
	.ampm {
		margin-left: var(--space-2);
		font-size: 0.22em;
		font-weight: 600;
		color: var(--text-tertiary);
		letter-spacing: normal;
	}

	@media (max-width: 414px) {
		.hero-clock[data-size='poster'] .time {
			font-size: clamp(2.75rem, 18vw, 4.75rem);
		}
	}
</style>
